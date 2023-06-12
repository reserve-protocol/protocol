// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/SignatureCheckerUpgradeable.sol";

/// Internal library for verifying metatx sigs for EOAs and smart contract wallets
/// See ERC1271
library PermitLib {
    function requireSignature(
        address owner,
        bytes32 hash,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) internal view {
        if (AddressUpgradeable.isContract(owner)) {
            require(
                IERC1271Upgradeable(owner).isValidSignature(hash, abi.encodePacked(r, s, v)) ==
                    0x1626ba7e,
                "ERC1271: Unauthorized"
            );
        } else {
            require(
                SignatureCheckerUpgradeable.isValidSignatureNow(
                    owner,
                    hash,
                    abi.encodePacked(r, s, v)
                ),
                "ERC20Permit: invalid signature"
            );
        }
    }
}
