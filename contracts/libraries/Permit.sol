// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/// Externally-included library for verifying metatx sigs for EOAs and smart contract wallets
/// See ERC1271
library PermitLib {
    function requireSignature(
        address owner,
        bytes32 hash,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external view {
        if (Address.isContract(owner)) {
            require(
                IERC1271(owner).isValidSignature(hash, abi.encodePacked(r, s, v)) == 0x1626ba7e,
                "ERC1271: Unauthorized"
            );
        } else {
            require(
                SignatureChecker.isValidSignatureNow(owner, hash, abi.encodePacked(r, s, v)),
                "ERC20Permit: invalid signature"
            );
        }
    }
}
