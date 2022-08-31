

How to fuzz with echidna-parade on a Google Cloud VM instance.

# Get a VM instance

This is mostly from the GCP [compute engine docs](https://cloud.google.com/compute/docs/instances/create-start-instance)

## Configure gcloud

I'm assuming you've already got `gcloud` installed on your dev machine. If not, https://cloud.google.com/sdk/docs/install .

``` bash
gcloud auth login
gcloud config set project rtoken-fuzz
gcloud config list project

# assumed defaults
gcloud config set compute/region us-central1 
gcloud config set compute/zone us-central1-a
```

## Create VM

On picking an instance type: I _bet_ that N2 is actually the right instance type for us; we'll want to steadily run each node at over 50% capacity, and that's substantially better on a less-dynamic system than an E2. (We _might_ need a massive-memory system instead?) The rest of this initial log happened on an E2, though, becuase that's the typical default, and I didn't really learn which to pick until later.

I'll assume we're using an `e2-standard-16` to start with, and branch out from there.

We won't bother with adding disks. By default, GCP gives you a single boot disk of no less than 10GB. That's the smallest disk it'll give you, and that's actually way more than we're going to need.

Create a VM with name `normal-ops-0` and machine type `e2-standard-16`:

```bash
gcloud compute instances create normal-ops-0 \
  --image-family=ubuntu-2204-lts --image-project=ubuntu-os-cloud \
  --machine-type=e2-standard-16 
```

## Grab ssh metadata and log in

```bash
gcloud compute config-ssh
ssh normal-ops-0.us-central1-a.rtoken-fuzz
```

# Install everything on the VM
## Setup echidna user

The remaining setup essentially follows ToB's [instructions](https://github.com/crytic/building-secure-contracts/blob/master/program-analysis/echidna/smart-contract-fuzzing-at-scale.md), albeit tweaked so that our installation actually works...


``` bash
sudo adduser echidna #just configured with a password. Something smarter is probably a good idea if we want to all login and play with these; for now it's in my pw manager under "Echidna User"
sudo usermod -aG sudo echidna
su echidna
```

## Install system packages

``` bash
sudo apt update
sudo apt install emacs-nox # So that we have a text editor at all. Install your own favorite text editor if you like, or just use nano, whatever.
sudo apt install python3-pip unzip

# Local packages will be installed to ~/.local/bin; we want them on PATH.
export PATH="$PATH:$HOME/.local/bin" && hash -r
echo 'export PATH="$PATH:$HOME/.local/bin"' >> .bashrc

# install python packages
pip3 install solc-select slither_analyzer echidna_parade

# Maybe overkill, but it won't take too long
solc-select install all 

# Install the things hardhat is going to need
# This will grab a huge mass of X libs that we really don't need. Oh well!
sudo apt install npm
sudo npm install -g n
sudo n lts

# Fetch and install echidna. The URL and filename given here assume most recent release is v2.0.2; see https://github.com/crytic/echidna/releases/latest
wget "https://github.com/crytic/echidna/releases/download/v2.0.2/echidna-test-2.0.2-Ubuntu-18.04.tar.gz"
tar -xf echidna-test-2.0.2-Ubuntu-18.04.tar.gz
mv echidna-test /home/echidna/.local/bin
```

## Install and test-run our code

``` bash
# Get our code
git clone https://github.com/reserve-protocol/protocol.git
cd protocol
git switch fuzz

# Install local dependencies. --force is necessary and seems to work fine.
npm install --force 

# Compile our code
TS_NODE_TRANSPILE_ONLY=1 npx hardhat compile

# Test run echidna briefly, see that it actually works
echidna-test . --config tools/quick-echidna-minutes.yml \
  --contract NormalOpsScenario --test-limit 300
```

# Launch Fuzzing!

echidna-parade follows an initial run of echidna with lots and lots of further echidna generations. Each of those generations has further randomized launch parameters, so that the overall test can explore more deeply. Each generation inherits the corpus improvements from previous generations, so they can all run increasingly detailed tests.


``` bash
tmux  # Easy way to ensure you're in a detachable session.

echidna-parade . --contract NormalOpsScenario \
  --config tools/echidna.config.yml \
  --initial_time 3600 --gen_time 1800 --timeout -1 --ncores 14 \
   > parade.log 2> parade.err &
```

The settings in this command are as follows:

- `--inital_time 3600` The initial instance runs for 1 hour (3600 sec)
- `--gen_time 1800` Each subsequent generation runs for 30 min (1800 sec)
- `--timeout -1`: Run the "parade" until otherwise stopped
- `--ncores 14`: Use up 15 cores in each generation. We're on a 16 core system, and you really want a spare core so you can actually use the console and see results. I'm leaving a second just to be careful; I've had problems.
