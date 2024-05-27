// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

contract DAOFeeRegistry is Ownable {
    uint256 public feeNumerator;
    address public feeRecipient;

    constructor(address owner_) Ownable() {
        _transferOwnership(owner_); // Ownership to DAO
    }

    function setFeeRecipient(address feeRecipient_) external onlyOwner {
        require(feeRecipient_ != address(0), "invalid fee recipient");
        require(feeRecipient_ != feeRecipient, "already set");

        feeRecipient = feeRecipient_;
    }

    function setFeeNumerator(uint256 feeNumerator_) external onlyOwner {
        // TODO: Need a more sensible max limit here...
        require(feeNumerator_ != 0 && feeNumerator < 1e4, "invalid fee numerator");

        feeNumerator = feeNumerator_;
    }
}
