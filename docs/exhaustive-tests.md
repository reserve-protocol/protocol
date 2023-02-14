# Exhaustive Testing
The exhuastive tests include `ZTradingExteremes.test.ts` and `ZZStRSR.test.ts`, and are meant to test the protocol when given permutations of input values on the extreme ends of the spectrum of possiblities.

## 1) Get a box
The exhuastive tests can take up to 24hr to complete, and use up a significant amount of memory (reports of up to 27gb).  Therefore, we want to run these on a vm in gcp.

I'm assuming you've already got `gcloud` installed on your dev machine. If not, https://cloud.google.com/sdk/docs/install .

```bash
gcloud auth login
gcloud config set project rtoken-fuzz
gcloud config list project

# assumed defaults
gcloud config set compute/region us-central1
gcloud config set compute/zone us-central1-a
```

### Option A: Create a new VM
Create the VM:

```bash
gcloud compute instances create exhaustive --custom-extensions --custom-vm-type=n2 --custom-cpu=4 --custom-memory=32 --image-family=ubuntu-2204-lts --image-project=ubuntu-os-cloud
```

Add Matt's special seasoning, for tmux and emacs QoL improvements (NOTE: This sets the tmux `ctrl-b` to `ctrl-z`):

```bash
git clone https://github.com/fiddlemath/dotfiles.git
cd dotfiles && . install.sh && cd ..
```

Install the relevant packages:

```bash
# Sudo and update apt
sudo su
apt update

# Install nvm
curl https://raw.githubusercontent.com/creationix/nvm/master/install.sh | bash 
source ~/.bashrc

# Install and use node v16
nvm install 16
nvm use 16

# Install npm & yarn
apt install npm
npm install --global yarn

# Install google cloud ops agent, for memory utilization plots
curl -sSO https://dl.google.com/cloudagents/add-google-cloud-ops-agent-repo.sh
sudo bash add-google-cloud-ops-agent-repo.sh --also-install
```

### Option B: Create a VM from existing Machine Image
We currently (__???????__) have a pre-cooked machine image that can be used for exhaustive testing.  It comes will all the above setup pre-installed.  Use the following command to launch a VM using this image.
```bash
gcloud compute instances create exhaustive --source-machine-image=exhaustivebox --zone=us-west1-a
```

## 2) SSH onto the box
If you need to pull the ssh-config from gcp:
```
gcloud compute config-ssh
```
Jump onto the instance:
```
ssh exhaustive.us-west1-a.rtoken-fuzz
```

## 3) Pull the repo, run the tests
```
git clone https://github.com/reserve-protocol/protocol.git
cd protocol
git checkout master
git pull
NODE_OPTIONS=--max-old-space-size=30000 SLOW=1 PROTO_IMPL=1 npx hardhat test test/Z*.test.ts
```