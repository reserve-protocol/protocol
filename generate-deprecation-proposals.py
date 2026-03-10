#!/usr/bin/env python3
"""Generate Gnosis Safe Transaction Builder JSON files for RToken deprecation.

Each file contains a single transaction: a call to Governor.propose() with the
full batch of deprecation actions encoded as targets/values/calldatas.

The timelock (controlled by the governor) is the OWNER of Main and executes
the actions after the proposal passes and the timelock delay elapses.
"""

import json
import os
import subprocess
import time

# Pre-computed calldata for individual deprecation actions
SET_BATCH_AUCTION_LENGTH_0 = "0x8881615a0000000000000000000000000000000000000000000000000000000000000000"
SET_ISSUANCE_THROTTLE_MIN = "0x5beafb3d0000000000000000000000000000000000000000000000000de0b6b3a76400000000000000000000000000000000000000000000000000000000000000000000"
PAUSE_ISSUANCE = "0xdf23cbb1"
SET_DISTRIBUTIONS_0_100 = "0xebb4d30e000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002710"

# Role bytes32 values
PAUSER_ROLE = "0x5041555345520000000000000000000000000000000000000000000000000000"
SHORT_FREEZER_ROLE = "0x53484f52545f465245455a455200000000000000000000000000000000000000"
LONG_FREEZER_ROLE = "0x4c4f4e475f465245455a45520000000000000000000000000000000000000000"
OWNER_ROLE = "0x4f574e4552000000000000000000000000000000000000000000000000000000"


def encode_grant_role(role_bytes32: str, account: str) -> str:
    account_padded = account.lower().replace("0x", "").zfill(64)
    role_padded = role_bytes32.replace("0x", "")
    return f"0x2f2ff15d{role_padded}{account_padded}"


def encode_revoke_role(role_bytes32: str, account: str) -> str:
    account_padded = account.lower().replace("0x", "").zfill(64)
    role_padded = role_bytes32.replace("0x", "")
    return f"0xd547741f{role_padded}{account_padded}"


def build_actions(timelock: str, main: str, rtoken: str, broker: str,
                  distributor: str, pausers: list, short_freezers: list,
                  long_freezers: list):
    """Build the (targets, calldatas) arrays for all deprecation actions.
    The timelock is the entity that executes these (it holds OWNER on Main).
    """
    targets = []
    calldatas = []

    # 1. Set batch auction length to 0
    targets.append(broker)
    calldatas.append(SET_BATCH_AUCTION_LENGTH_0)

    # 2. Set issuance throttle to 1e18 (minimum)
    targets.append(rtoken)
    calldatas.append(SET_ISSUANCE_THROTTLE_MIN)

    # 3. Grant PAUSER role to timelock (so it can pause)
    targets.append(main)
    calldatas.append(encode_grant_role(PAUSER_ROLE, timelock))

    # 4. Pause minting
    targets.append(main)
    calldatas.append(PAUSE_ISSUANCE)

    # 5. Set distribution to 0% RToken, 100% RSR
    targets.append(distributor)
    calldatas.append(SET_DISTRIBUTIONS_0_100)

    # 6. Remove all PAUSER roles (including the timelock we just granted)
    all_pausers = sorted(set([p.lower() for p in pausers] + [timelock.lower()]))
    for pauser in all_pausers:
        targets.append(main)
        calldatas.append(encode_revoke_role(PAUSER_ROLE, pauser))

    # 7. Remove all SHORT_FREEZER roles
    for freezer in sorted(set([f.lower() for f in short_freezers])):
        targets.append(main)
        calldatas.append(encode_revoke_role(SHORT_FREEZER_ROLE, freezer))

    # 8. Remove all LONG_FREEZER roles
    for freezer in sorted(set([f.lower() for f in long_freezers])):
        targets.append(main)
        calldatas.append(encode_revoke_role(LONG_FREEZER_ROLE, freezer))

    # 9. Remove all OWNER roles (MUST BE LAST)
    targets.append(main)
    calldatas.append(encode_revoke_role(OWNER_ROLE, timelock))

    return targets, calldatas


def encode_propose(targets: list, calldatas: list, description: str) -> str:
    """Use cast to ABI-encode Governor.propose(address[],uint256[],bytes[],string)."""
    targets_str = "[" + ",".join(targets) + "]"
    values_str = "[" + ",".join(["0"] * len(targets)) + "]"
    calldatas_str = "[" + ",".join(calldatas) + "]"

    result = subprocess.run(
        [
            "cast", "calldata",
            "propose(address[],uint256[],bytes[],string)",
            targets_str,
            values_str,
            calldatas_str,
            description,
        ],
        capture_output=True, text=True, check=True,
    )
    return result.stdout.strip()


def generate_proposal(name: str, chain_id: int, governor: str, timelock: str,
                      main: str, rtoken: str, broker: str, distributor: str,
                      pausers: list, short_freezers: list, long_freezers: list) -> dict:
    targets, calldatas = build_actions(
        timelock=timelock, main=main, rtoken=rtoken, broker=broker,
        distributor=distributor, pausers=pausers,
        short_freezers=short_freezers, long_freezers=long_freezers,
    )

    description = (
        f"Deprecate {name}\\n\\n"
        f"Actions:\\n"
        f"1. Set batch auction length to 0\\n"
        f"2. Set issuance throttle to 1e18 (minimum)\\n"
        f"3. Pause minting\\n"
        f"4. Set distribution to 0% RToken, 100% RSR\\n"
        f"5. Remove all PAUSER roles\\n"
        f"6. Remove all SHORT_FREEZER roles\\n"
        f"7. Remove all LONG_FREEZER roles\\n"
        f"8. Remove all OWNER roles"
    )

    propose_calldata = encode_propose(targets, calldatas, description)

    return {
        "version": "1.0",
        "chainId": str(chain_id),
        "createdAt": int(time.time()),
        "meta": {
            "name": f"Deprecate {name}",
            "description": f"Governance proposal to deprecate {name}",
            "txBuilderVersion": "1.16.5",
            "createdFromSafeAddress": "",
            "createdFromOwnerAddress": "",
            "checksum": "",
        },
        "transactions": [
            {
                "to": governor,
                "value": "0",
                "data": propose_calldata,
            }
        ],
    }


# RToken definitions
# governor = Governor contract (where propose() is called)
# timelock = TimelockController (OWNER of Main, executor of proposals)
rtokens = [
    {
        "name": "dgnETH",
        "filename": "deprecate-dgnETH.json",
        "chain_id": 1,
        "governor": "0xb7cb3880564a1f8698018ecdc78972f93b2615e6",
        "timelock": "0x05623fcee6fb48b7c8058022c48a72dbce09878e",
        "main": "0x0A82c906E283FE813fa591D104E0Bfe75609cD35",
        "rtoken": "0x005F893EcD7bF9667195642f7649DA8163e23658",
        "broker": "0x9baDe46AC6b0c6e3460513Ec71e5B2636D8ddac0",
        "distributor": "0x00365b8B3B2A3294554CfB70d288A8ac19d9e087",
        "pausers": [
            "0xd5fe2780eb882d1da78f2136b81c2a4395488c98",
            "0x9ca72f031f789f51bd35cc34583c7b7a7d0871a3",
        ],
        "short_freezers": [
            "0xd5fe2780eb882d1da78f2136b81c2a4395488c98",
            "0xd733d4cc5b42206a62ed7b1ceec5b4d61898f429",
            "0x03d03a026e71979be3b08d44b01eae4c5ff9da99",
            "0x8785b3a82d1e3c067cee8ff830df56c78f13526d",
            "0x9ca72f031f789f51bd35cc34583c7b7a7d0871a3",
        ],
        "long_freezers": [
            "0xd5fe2780eb882d1da78f2136b81c2a4395488c98",
        ],
    },
    {
        "name": "hyUSD (mainnet)",
        "filename": "deprecate-hyUSD-mainnet.json",
        "chain_id": 1,
        "governor": "0x3f26ef1460d21a99425569ef3148ca6059a7eeae",
        "timelock": "0x788fd297b4d497e44e4bf25d642fbeca3018b5d2",
        "main": "0x2cabaa8010b3fbbDEeBe4a2D0fEffC2ed155bf37",
        "rtoken": "0xaCdf0DBA4B9839b96221a8487e9ca660a48212be",
        "broker": "0x44344ca9014BE4bB622037224d107493586f35ed",
        "distributor": "0x0297941cCB71f5595072C4fA34CE443b6C5b47A0",
        "pausers": [
            "0xd5fe2780eb882d1da78f2136b81c2a4395488c98",
            "0xadee783168faae3f5e1151de989ce3f252cc9a05",
            "0x624f9f076ed42ba3b37c3011dc5a1761c2209e1c",
        ],
        "short_freezers": [
            "0xd5fe2780eb882d1da78f2136b81c2a4395488c98",
            "0x624f9f076ed42ba3b37c3011dc5a1761c2209e1c",
        ],
        "long_freezers": [
            "0xd5fe2780eb882d1da78f2136b81c2a4395488c98",
            "0x624f9f076ed42ba3b37c3011dc5a1761c2209e1c",
        ],
    },
    {
        "name": "hyUSD (base)",
        "filename": "deprecate-hyUSD-base.json",
        "chain_id": 8453,
        "governor": "0xffef97179f58a582def73e6d2e4bcd2bdc8ca128",
        "timelock": "0x4284d76a03f9b398ff7aec58c9dec94b289070cf",
        "main": "0xA582985c68ED30a052Ff0b07D74931140bd5a00F",
        "rtoken": "0xCc7FF230365bD730eE4B352cC2492CEdAC49383e",
        "broker": "0x0E05139662e0C8752a100DB08DA0C7E435B8aC94",
        "distributor": "0xf0a83bC73E9bAeb69b2fBB1e48bCdabf9C1012ca",
        "pausers": [
            "0xc3954aa47e469add8b5ad8c243e6c72abbe08549",
        ],
        "short_freezers": [
            "0xc3954aa47e469add8b5ad8c243e6c72abbe08549",
        ],
        "long_freezers": [
            "0x6f1d6b86d4ad705385e751e6e88b0fdfdbadf298",
        ],
    },
    {
        "name": "MAAT",
        "filename": "deprecate-MAAT.json",
        "chain_id": 8453,
        "governor": "0x0f7f1442da7f687bb877fbee0539fa8d6e4d1a02",
        "timelock": "0xe67ceb03efdf9b3fb5c3febf3103e2efd3a76a1b",
        "main": "0xDf699488CA4340F71d24Cff1424146c836407d4e",
        "rtoken": "0x641B0453487C9D14c5df96d45a481ef1dc84e31f",
        "broker": "0x6baffC6282fDC15fE6AF9e2698e4b6D664CbC65c",
        "distributor": "0x0FF73c65202FA6d884065aE208A12a5d26B579c9",
        "pausers": [],
        "short_freezers": [],
        "long_freezers": [],
    },
    {
        "name": "KNOX",
        "filename": "deprecate-KNOX.json",
        "chain_id": 42161,
        # TODO: Fill in KNOX governor address on Arbitrum (CLI doesn't support Arbitrum)
        "governor": "FILL_IN_KNOX_GOVERNOR_ADDRESS",
        "timelock": "0xccb548e8f74eb2f613f53dd2c389842dd4a13e22",
        "main": "0xB0F377e58F4fA4bC42067868A699666bd7DAc565",
        "rtoken": "0x0BBF664D46becc28593368c97236FAa0fb397595",
        "broker": "0x8B96d8b68E33EB62558c5ff3B395F0AD24d3b5fF",
        "distributor": "0xb8b83D56ab18E9bd5B554c2709B50DE290678785",
        "pausers": [
            "0x7a58ef5205a7b5eb22259d0dc7917b24e72726ad",
            "0x2e84581ef04700aa351b1184f2aa0bc1617fa989",
        ],
        "short_freezers": [
            "0x7a58ef5205a7b5eb22259d0dc7917b24e72726ad",
            "0x75c832d2e3ad4c82af61293e12c71add7bc2831c",
        ],
        "long_freezers": [
            "0x7a58ef5205a7b5eb22259d0dc7917b24e72726ad",
        ],
    },
    {
        "name": "USDC+",
        "filename": "deprecate-USDCplus.json",
        "chain_id": 1,
        "governor": "0xc837c557071d604bcb1058c8c4891ddbe8fdd630",
        "timelock": "0x6c957417cb6df6e821eec8555dee8b116c291999",
        "main": "0xeC11Cf537497141aC820615F4f399be4a1638Af6",
        "rtoken": "0xFc0B1EEf20e4c68B3DCF36c4537Cfa7Ce46CA70b",
        "broker": "0x7aFc1d0bDFE2F3887466534516447bA4cE97B305",
        "distributor": "0x348F00534b0aa8b575D24356E7C3e1a5e6403fA1",
        "pausers": [
            "0x52ea58f4fc3ced48fa18e909226c1f8a0ef887dc",
            "0xfdefe2e8ae439547a4ca4b2656715e5bbceb295b",
            "0x8785b3a82d1e3c067cee8ff830df56c78f13526d",
        ],
        "short_freezers": [
            "0xfdefe2e8ae439547a4ca4b2656715e5bbceb295b",
            "0x52ea58f4fc3ced48fa18e909226c1f8a0ef887dc",
            "0x8785b3a82d1e3c067cee8ff830df56c78f13526d",
        ],
        "long_freezers": [
            "0xfdefe2e8ae439547a4ca4b2656715e5bbceb295b",
            "0x52ea58f4fc3ced48fa18e909226c1f8a0ef887dc",
            "0x8785b3a82d1e3c067cee8ff830df56c78f13526d",
        ],
    },
    {
        "name": "BSDX",
        "filename": "deprecate-BSDX.json",
        "chain_id": 8453,
        "governor": "0xe8699d59ddcec4c0eddba32dec148e593324b446",
        "timelock": "0xfbb633436f9998ef030c3dd1f636cc92a669da8f",
        "main": "0x9129E75ac2fF30C1FF6864aDf9c63C5767e4F044",
        "rtoken": "0x8f0987DDb485219c767770e2080E5cC01ddc772a",
        "broker": "0x7B587720921FeFdEE00ac01C2590f060E932bce9",
        "distributor": "0x986377A8561B336e1C58FB370B3DF302eBbF21BC",
        "pausers": [
            "0x27f67409b292fef1a6735c007e7f46e1ea374521",
            "0x03d03a026e71979be3b08d44b01eae4c5ff9da99",
            "0x8785b3a82d1e3c067cee8ff830df56c78f13526d",
            "0x95fac8a1ad70c71abb31240c256aca0892bf55c3",
        ],
        "short_freezers": [
            "0x27f67409b292fef1a6735c007e7f46e1ea374521",
            "0x03d03a026e71979be3b08d44b01eae4c5ff9da99",
            "0x8785b3a82d1e3c067cee8ff830df56c78f13526d",
            "0x95fac8a1ad70c71abb31240c256aca0892bf55c3",
        ],
        "long_freezers": [
            "0x27f67409b292fef1a6735c007e7f46e1ea374521",
        ],
    },
    {
        "name": "VAYA",
        "filename": "deprecate-VAYA.json",
        "chain_id": 8453,
        "governor": "0xeb583ea06501f92e994c353ad2741a35582987aa",
        "timelock": "0xee3ec997a37e661a42673d7a489fbf0e5ed0c223",
        "main": "0x6c678DE5334B86EAeEe6d9c8a2d59FfB9E4167F2",
        "rtoken": "0xC9a3e2B3064c1c0546D3D0edc0A748E9f93Cf18d",
        "broker": "0xe75111b9D5C1344D0edF5355bda384Dc36eB3F7e",
        "distributor": "0x93aA969C89a102184938A05A8e16572A4DeB5873",
        "pausers": [
            "0xce8c45b19bd2add516670698b9004b53dc39b71e",
        ],
        "short_freezers": [
            "0xce8c45b19bd2add516670698b9004b53dc39b71e",
        ],
        "long_freezers": [
            "0xce8c45b19bd2add516670698b9004b53dc39b71e",
        ],
    },
    {
        "name": "rgUSD",
        "filename": "deprecate-rgUSD.json",
        "chain_id": 1,
        "governor": "0x409bac94c4207c6627ea5f4e4ffb7128e8f654fc",
        "timelock": "0x9ad9e73e38c8506a664a3a37e8a9ce910b6fbeb4",
        "main": "0xB436459251b144e6CfEDa33f8b814fFF450053B2",
        "rtoken": "0x78da5799CF427Fee11e9996982F4150eCe7a99A7",
        "broker": "0x1BED0098050CA52b8e2b855610DE64308f3CE336",
        "distributor": "0x6f3803eE819579F385cAEa44978E2B6D15D823C4",
        "pausers": [
            "0xbb73485ac579f5014a257aef535944f80cd3fa32",
            "0x8785b3a82d1e3c067cee8ff830df56c78f13526d",
            "0xe45c3179b135288dd8e1e3c20eafebb2b2e7d771",
            "0x707778ae959e52acac25aaf28114ee04a5c0bf55",
        ],
        "short_freezers": [
            "0xbb73485ac579f5014a257aef535944f80cd3fa32",
            "0x8785b3a82d1e3c067cee8ff830df56c78f13526d",
            "0xe45c3179b135288dd8e1e3c20eafebb2b2e7d771",
            "0x707778ae959e52acac25aaf28114ee04a5c0bf55",
        ],
        "long_freezers": [
            "0xbb73485ac579f5014a257aef535944f80cd3fa32",
        ],
    },
]


if __name__ == "__main__":
    os.makedirs("proposals", exist_ok=True)

    for rt in rtokens:
        if rt["governor"].startswith("FILL_IN"):
            print(f"SKIPPED {rt['filename']} — governor address missing for {rt['name']}")
            continue

        proposal = generate_proposal(
            name=rt["name"],
            chain_id=rt["chain_id"],
            governor=rt["governor"],
            timelock=rt["timelock"],
            main=rt["main"],
            rtoken=rt["rtoken"],
            broker=rt["broker"],
            distributor=rt["distributor"],
            pausers=rt["pausers"],
            short_freezers=rt["short_freezers"],
            long_freezers=rt["long_freezers"],
        )

        filepath = f"proposals/{rt['filename']}"
        with open(filepath, "w") as f:
            json.dump(proposal, f, indent=2)

        print(f"Generated {filepath} (chain {rt['chain_id']})")
