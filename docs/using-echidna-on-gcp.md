How to fuzz with echidna-parade on a Google Cloud VM instance.

# Get a VM instance

This is mostly from the GCP [compute engine docs](https://cloud.google.com/compute/docs/instances/create-start-instance)

## Configure gcloud

I'm assuming you've already got `gcloud` installed on your dev machine. If not, https://cloud.google.com/sdk/docs/install .

```bash
gcloud auth login
gcloud config set project rtoken-fuzz
gcloud config list project

# assumed defaults
gcloud config set compute/region us-central1
gcloud config set compute/zone us-central1-a
```

## Create VM

Seems like N2 is the best instance type. I've done a little bit of performance testing here, but it's not totally obvious. One issue is that each project is limited to a quote of 8 N2 CPUs by default;

We won't bother with adding disks. By default, GCP gives you a single boot disk of no less than 10GB. That's the smallest disk it'll give you, and that's actually way more than we're going to need.

```bash
export NODENAME=difftest
gcloud compute instances create $NODENAME \
  --custom-extensions   --custom-vm-type=n2 \
  --custom-cpu=2 --custom-memory=256 \
  --image-family=ubuntu-2204-lts --image-project=ubuntu-os-cloud
```

## Grab ssh metadata and log in

```bash
gcloud compute config-ssh
ssh ${NODENAME}.us-central1-a.rtoken-fuzz
```

# Install everything on the VM

## Initial setup

I drop in my personal setup, for tmux and emacs QoL improvements.
(NOTE: This sets the tmux `ctrl-b` to `ctrl-z`)

```bash
git clone https://github.com/fiddlemath/dotfiles.git
cd dotfiles && . install.sh && cd ..
```

## Install system packages

```bash
sudo apt update
# I setup emacs so that there's an editor at all. Use whatever you prefer!
sudo apt install emacs-nox python3-pip unzip moreutils

# Local packages will be installed to ~/.local/bin; we want them on PATH.
export PATH="$PATH:$HOME/.local/bin" && hash -r
echo 'export PATH="$PATH:$HOME/.local/bin"' >> .bashrc

# install python packages
pip3 install solc-select slither_analyzer echidna_parade
# Maybe overkill, but it won't take too long
solc-select install all

# Install node. Use the snap, instead of the apt package, to avoid installing
# _way too much_ other junk
sudo snap install node --classic --channel=16

# Fetch and install echidna. The URL and filename given here assume most recent release is v2.0.3; see https://github.com/crytic/echidna/releases/latest
wget "https://github.com/crytic/echidna/releases/download/v2.0.3/echidna-test-2.0.3-Ubuntu-18.04.tar.gz"
tar -xf echidna-test-2.0.3-Ubuntu-18.04.tar.gz
mv echidna-test ~/.local/bin
rm echidna-test-2.0.3-Ubuntu-18.04.tar.gz

# Install echidna parade (from source, with live files)
git clone https://github.com/crytic/echidna-parade.git
pip install -e echidna-parade/

# Install google cloud ops agent, for memory utilization plots
curl -sSO https://dl.google.com/cloudagents/add-google-cloud-ops-agent-repo.sh
sudo bash add-google-cloud-ops-agent-repo.sh --also-install
```

## Install and test-run our code

```bash
# Get our code
git clone https://github.com/reserve-protocol/protocol.git
cd protocol
git switch fuzz

# Install local dependencies. --force is necessary; seems to work fine.
npm install --force

# Compile our code
TS_NODE_TRANSPILE_ONLY=1 npx hardhat compile

# Test run echidna briefly, see that it actually works
# you have to change "YourScenario" to the right thing yourself
echidna-test . --config tools/echidna.config.yml \
  --contract YourScenario --test-limit 3
```

# Launch Fuzzing!

echidna-parade follows an initial run of echidna with lots and lots of further echidna generations. Each of those generations has further randomized launch parameters, so that the overall test can explore more deeply. Each generation inherits the corpus improvements from previous generations, so they can all run increasingly detailed tests.

Edit `protocol/tools/echinda.config.yml`:

- set seqLen: 100
- set testLimit: 10000000
- remove solcArgs

Write `launch-parade.sh`:

```bash
nice echidna-parade protocol --name parade \
    --contract YourScenario \
    --config protocol/tools/echidna.config.yml \
    --ncores 4 \
    --timeout -1 \
    --gen_time 1800 --initial_time 3600 \
    --minseqLen 10 --maxseqLen 100 \
    --clean-results
```

Back in the shell:

```bash
tmux  # Easy way to ensure you're in a detachable session.
bash launch-parade.sh
```
