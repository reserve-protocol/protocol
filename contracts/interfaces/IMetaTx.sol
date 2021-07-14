// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

interface IMetaTx {
    function getDomainSeparator() external view returns (bytes32);
    function getNonce(address user) external view returns (uint256);
    function executeMetaTransaction(
        address userAddress,
        bytes memory functionSignature,
        bytes32 sigR,
        bytes32 sigS,
        uint8 sigV
    ) external payable returns (bytes memory);
}
