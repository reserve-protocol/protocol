// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/ECDSAUpgradeable.sol";

import "./interfaces/IRelayERC20.sol";

abstract contract RelayERC20 is IRelayERC20, ERC20Upgradeable {
    mapping(address => uint256) public override metaNonces;

    event TransferForwarded(
        bytes sig,
        address indexed from,
        address indexed to,
        uint256 indexed amount,
        uint256 fee
    );

    /// Checks the transfer signature in-tx in order to enable metatxs.
    /// Note that `amount` is not reduced by `fee`; the fee is taken separately.
    /// Adheres to the SafeERC20 spec of reverting on failure, unlike ERC20 interface.
    function relayedTransfer(
        bytes calldata sig,
        address from,
        address to,
        uint256 amount,
        uint256 fee
    ) public virtual override {
        bytes32 hash = keccak256(
            abi.encodePacked(
                "relayedTransfer",
                address(this),
                from,
                to,
                amount,
                fee,
                metaNonces[from]
            )
        );
        metaNonces[from]++;

        address recoveredSigner = _recoverSignerAddress(hash, sig);
        require(recoveredSigner == from, "RelayERC20: Invalid signature");

        if (fee != 0) {
            _transfer(from, address(this), fee);
        }
        _transfer(from, to, amount);
        emit TransferForwarded(sig, from, to, amount, fee);
    }

    /// Recover the signer's address from the hash and signature.
    function _recoverSignerAddress(bytes32 hash, bytes memory sig) internal pure returns (address) {
        bytes32 ethMessageHash = ECDSAUpgradeable.toEthSignedMessageHash(hash);
        return ECDSAUpgradeable.recover(ethMessageHash, sig);
    }
}
