# Exhaustive Testing

The exhaustive tests include `Broker.test.ts`, `Furnace.test.ts`, `RToken.test.ts`, `ZTradingExtremes.test.ts` and `ZZStRSR.test.ts`, and are meant to test the protocol when given permutations of input values on the extreme ends of the spectrum of possibilities.

The env vars related to exhaustive testing are `EXTREME` and `SLOW`.

## 1) Get a box

The exhaustive tests can take up to 24hr to complete, and use up a significant amount of memory (reports of up to 27gb). Therefore, we want to run these on a vm in gcp.

I'm assuming you've already got `gcloud` installed on your dev machine. If not, https://cloud.google.com/sdk/docs/install .

```bash
gcloud auth login
gcloud config set project rtoken-testing
gcloud config list project

# assumed defaults
gcloud config set compute/region us-central1
gcloud config set compute/zone us-central1-a
```

### Option A: Create a new VM

(Skip this and go to Option B, ideally)

Create the VM:

```bash
gcloud compute instances create exhaustive --machine-type=n2d-highmem-8 --image-family=ubuntu-2204-lts --image-project=ubuntu-os-cloud
```

Pull the ssh-config from gcp:

```
gcloud compute config-ssh
```

Jump onto the instance:

```
ssh exhaustive.us-central1-a.rtoken-testing
```

Add Matt's special seasoning, for tmux and emacs QoL improvements (NOTE: This sets the tmux `ctrl-b` to `ctrl-z`):

```bash
git clone https://github.com/fiddlemath/dotfiles.git
cd dotfiles && . install.sh && cd ..
```

Install the relevant packages:

```bash
# Sudo and update apt
sudo apt update

# Install nvm
curl https://raw.githubusercontent.com/creationix/nvm/master/install.sh | bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion

# Install and use node v18
nvm install 18
nvm use 18

# Install npm & yarn
sudo apt install npm
npm install --global yarn

# Install google cloud ops agent, for memory utilization plots
curl -sSO https://dl.google.com/cloudagents/add-google-cloud-ops-agent-repo.sh
sudo bash add-google-cloud-ops-agent-repo.sh --also-install
```

### Option B: Create a VM from existing Machine Image

We currently (2/23/23) have a pre-cooked machine image that can be used for exhaustive testing. It comes will all the above setup pre-installed. Use the following command to launch a VM using this image.

```bash
gcloud compute instances create exhaustive --source-machine-image=exhaustive-box --zone=us-central1-a
```

## 2) SSH onto the box

If you need to pull the ssh-config from gcp:

```
gcloud compute config-ssh
```

Jump onto the instance:

```
ssh exhaustive.us-central1-a.rtoken-testing
```

## 3) Run the tests

Pull the repo, checkout latest `master` branch (or whichever branch you want to test), install packages, and compile:

```
git clone https://github.com/reserve-protocol/protocol.git
cd protocol
git checkout master
git pull
yarn install
yarn compile
```

Tmux and run the tests:

```
tmux
bash ./scripts/exhaustive-tests/run-exhaustive-tests.sh
```

When the test are complete, you'll find the console output in `tmux-1.log` and `tmux-2.log`.

Detach from the tmux session:

```
ctrl-z
d
```

If you run into this error `SyntaxError: Unexpected token '?'`, just `nvm uninstall <version>; nvm install <version>; nvm use <version>;`.
