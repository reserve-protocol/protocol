// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../deps/zeppelin/token/ERC20/ERC20.sol";
import "../deps/zeppelin/utils/cryptography/ECDSA.sol";
import "../interfaces/IRelayERC20.sol";

abstract contract RelayERC20 is IRelayERC20, ERC20 {

    event TransferForwarded(
        bytes sig,
        address indexed from,
        address indexed to,
        uint256 indexed amount,
        uint256 fee
    );

    mapping(address => uint) public override relayNonce;

    /// Checks the transfer signature in-tx in order to enable metatxs. 
    /// Note that `amount` is not reduced by `fee`; the fee is taken separately.
    /// Adheres to the SafeERC20 spec of reverting on failure, unlike ERC20 interface.
    function relayedTransfer(
        bytes calldata sig,
        address from,
        address to,
        uint256 amount,
        uint256 fee
    )
        public virtual override
    {
        bytes32 hash = keccak256(abi.encodePacked(
            "relayedTransfer",
            address(this),
            from,
            to,
            amount,
            fee,
            relayNonce[from]
        ));
        relayNonce[from]++;

        address recoveredSigner = _recoverSignerAddress(hash, sig);
        require(recoveredSigner == from, "invalid signature");

        _transfer(from, address(this), fee);
        _transfer(from, to, amount);
        emit TransferForwarded(sig, from, to, amount, fee);
    }

    /// Recover the signer's address from the hash and signature.
    function _recoverSignerAddress(bytes32 hash, bytes memory sig)
        internal pure
        returns (address)
    {
        bytes32 ethMessageHash = ECDSA.toEthSignedMessageHash(hash);
        return ECDSA.recover(ethMessageHash, sig);
    }
}
