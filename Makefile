export REPO_DIR = $(shell pwd)
export SOLC_VERSION = 0.8.4

root_contracts := Basket Manager SwapProposal WeightProposal Vault ProposalFactory
rsv_contracts := PreviousReserve Reserve ReserveEternalStorage Relayer
test_contracts := BasicOwnable ReserveV2 ManagerV2 BasicERC20 VaultV2 BasicTxFee
contracts := $(root_contracts) $(rsv_contracts) $(test_contracts) ## All contract names

sol := $(shell find contracts -name '*.sol' -not -name '.*' ) ## All Solidity files
json := $(foreach contract,$(contracts),evm/$(contract).json) ## All JSON files
abi := $(foreach contract,$(contracts),abi/$(contract).go) ## All ABI files
myth_analyses := $(foreach solFile,$(sol),analysis/$(subst contracts/,,$(basename $(solFile))).myth.md)
flat := $(foreach solFile,$(sol),flat/$(subst contracts/,,$(solFile)))

runs := 100
decimals := "6,18,6" # up to 10 tokens max, probably stay between 1 and 36 decimals

all: test json abi

abi: $(abi)
json: $(json)
flat: $(flat)

test: abi
    go test ./tests -tags all

testRelay: abi
    go test ./tests/base.go ./tests/relayer_test.go

fuzz: abi
    go test ./tests -v -tags fuzz -args -decimals=$(decimals) -runs=$(runs)

clean:
    rm -rf abi evm sol-coverage-evm analysis flat

sizes: json
    scripts/sizes $(json)

flatten:
    scripts/flatten.pl --contractsdir=contracts --mainsol=rsv/Reserve.sol --outputsol=flattened/Reserve.sol_flattened.sol --verbose
    scripts/flatten.pl --contractsdir=contracts --mainsol=Manager.sol --outputsol=flattened/Manager.sol_flattened.sol --verbose
    scripts/flatten.pl --contractsdir=contracts --mainsol=rsv/Relayer.sol --outputsol=flattened/Relayer.sol_flattened.sol --verbose

check: $(sol)
    slither contracts
triage-check: $(sol)
    slither --triage-mode contracts

# Invoke this with parallel builds off: `make -j1 mythril`
# If you have parallel make turned on, this won't work right, because mythril.
mythril: $(myth_analyses)


fmt:
    npx solium -d contracts/ --fix
    npx solium -d tests/echidna/ --fix

run-geth:
    docker run -it --rm -p 8545:8501 0xorg/devnet

# Pattern rule: generate ABI files
abi/%.go: evm/%.json genABI.go
    go run genABI.go $*

# solc recipe template for building all the JSON outputs.
# To use as a build recipe, optimized for (e.g.) 1000 runs,
# use "$(call solc,1000)" in your recipe.
define solc
@mkdir -p evm
solc --allow-paths $(REPO_DIR)/contracts --optimize --optimize-runs $1 \
     --combined-json=abi,bin,bin-runtime,srcmap,srcmap-runtime,userdoc,devdoc \
     $< > $@
endef

evm/Basket.json : contracts/Basket.sol $(sol)
    $(call solc,100000)

evm/Manager.json: contracts/Manager.sol $(sol)
    $(call solc,10000)

evm/ProposalFactory.json: contracts/Proposal.sol $(sol)
    $(call solc,100)

evm/SwapProposal.json: contracts/Proposal.sol $(sol)
    $(call solc,3)

evm/WeightProposal.json: contracts/Proposal.sol $(sol)
    $(call solc,3)

evm/Vault.json: contracts/Vault.sol $(sol)
    $(call solc,100000)

evm/Relayer.json: contracts/rsv/Relayer.sol $(sol)
    $(call solc,1000000)

evm/PreviousReserve.json: contracts/test/PreviousReserve.sol $(sol)
    $(call solc,1000000)

evm/Reserve.json: contracts/rsv/Reserve.sol $(sol)
    $(call solc,1000000)

evm/ReserveEternalStorage.json: contracts/rsv/ReserveEternalStorage.sol $(sol)
    $(call solc,1000000)

evm/BasicOwnable.json: contracts/test/BasicOwnable.sol $(sol)
    $(call solc,1)

evm/ReserveV2.json: contracts/test/ReserveV2.sol $(sol)
    $(call solc,1000000)

evm/ManagerV2.json: contracts/test/ManagerV2.sol $(sol)
    $(call solc,10000)

evm/BasicERC20.json: contracts/test/BasicERC20.sol $(sol)
    $(call solc,1000000)

evm/VaultV2.json: contracts/test/VaultV2.sol $(sol)
    $(call solc,1)

evm/BasicTxFee.json: contracts/test/BasicTxFee.sol $(sol)
    $(call solc,1000000)


# myth runs mythril, and plops its output in the "analysis" directory
define myth
@mkdir -p $(@D)
myth a $< > $@
endef

# By default, don't specify the contract name
analysis/%.myth.md: contracts/%.sol $(sol)
    $(call myth)

define myth_specific
@mkdir -p $(@D)
myth a $<:$1 > $@
endef

# But, where there's more than one contract in the source file, do.
analysis/ProposalFactory.myth.md: contracts/Proposal.sol $(sol)
    $(call myth_specific ProposalFactory)

analysis/WeightProposal.myth.md: contracts/Proposal.sol $(sol)
    $(call myth_specific WeightProposal)

analysis/SwapProposal.myth.md: contracts/Proposal.sol $(sol)
    $(call myth_specific SwapProposal)


flat/%.sol: contracts/%.sol
    @mkdir -p $(@D)
    go run github.com/coburncoburn/SolidityFlattery -input $< -output $(basename $@)

# Mark "action" targets PHONY, to save occasional headaches.
.PHONY: all clean json abi test fuzz check triage-check mythril fmt run-geth sizes flat
