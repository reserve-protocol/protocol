How to fuzz with echidna on a Google Cloud VM instance.

# 1) Get a VM instance

This is mostly from the GCP [compute engine docs](https://cloud.google.com/compute/docs/instances/create-start-instance)

## Configure gcloud

I'm assuming you've already got `gcloud` installed on your dev machine. If not, https://cloud.google.com/sdk/docs/install .

```bash
gcloud auth login
gcloud config set project rtoken-testing
gcloud config list project

# assumed defaults
gcloud config set compute/region us-central1
gcloud config set compute/zone us-central1-a
```
NOTE: **google cloud limits the number of n2 CPU cores that can be used in a given region to 8**. therefore, be sure to put each vm in a new region (or a maximum of 2 vms in 1 region). [gcloud regions](https://cloud.google.com/compute/docs/regions-zones)

## Setup a VM
It is recommended to run each fuzzing scenario (NormalOps, RebalancingOps, ChaosOps) on its own VM.
### Option A: Create a new VM

Seems like N2 is the best instance type. I've done a little bit of performance testing here, but it's not totally obvious. One issue is that each project is limited to a quote of 8 N2 CPUs by default;

We won't bother with adding disks. By default, GCP gives you a single boot disk of no less than 10GB. That's the smallest disk it'll give you, and that's actually way more than we're going to need.

```bash
export NODENAME=difftest
gcloud compute instances create difftest \
  --custom-extensions   --custom-vm-type=n2 \
  --custom-cpu=4 --custom-memory=384 \
  --image-family=ubuntu-2204-lts --image-project=ubuntu-os-cloud
```

### Option B: Create a VM from existing Machine Image
We currently (1/24/23) have a pre-cooked machine image that can be used for fuzzing.  Use the following command to launch a VM using this image.  If you setup a VM from an existing machine image, you can skip step 2 and go directly to step 3.
```bash
gcloud compute instances create fuzz-normal --source-machine-image=fuzzbox --zone=us-west1-a
```

## Grab ssh metadata and log in

```bash
gcloud compute config-ssh
ssh ${NODENAME}.us-central1-a.rtoken-testing
```


# 2) Install everything on the VM

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
pip3 install solc-select
pip3 install slither_analyzer

# Maybe overkill, but it won't take too long
solc-select install all

# Install node. Use the snap, instead of the apt package, to avoid installing
# _way too much_ other junk
sudo snap install node --classic --channel=16

# Fetch and install echidna. The URL and filename given here assume most recent release is v2.3.1; see https://github.com/crytic/echidna/releases/latest
wget "https://github.com/crytic/echidna/releases/download/v2.3.1/echidna-2.3.1-x86_64-Linux.tar.gz"
tar -xf echidna-2.3.1-x86_64-Linux.tar.gz
mv echidna ~/.local/bin
rm echidna-2.3.1-x86_64-Linux.tar.gz

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
yarn install

# Compile our code
TS_NODE_TRANSPILE_ONLY=1 npx hardhat compile

# Test run echidna briefly, see that it actually works
# you have to change "YourScenario" to the right thing yourself
echidna . --config tools/echidna.config.yml \
  --contract ${SCENARIO} --test-limit 3
```

<!-- HERE -->

# 3) Launch Fuzzing!

Be sure you are on the latest commit of the fuzzing branch.
```bash
cd protocol
git checkout fuzz
git pull
```

The possible scenarios are:
- NormalOpsScenario
- ChaosOpsScenario
- RebalancingScenario


NOTE: tmux `Ctrl-b` has been mapped to `Ctrl-z`
