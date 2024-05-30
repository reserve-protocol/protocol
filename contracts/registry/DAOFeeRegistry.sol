// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

contract DAOFeeRegistry is Ownable {
    address private feeRecipient;
    uint256 private defaultFeeNumerator; // 1e4 = 100% fee
    mapping(address => uint256) private rTokenFeeNumerator;

    constructor(address owner_) Ownable() {
        _transferOwnership(owner_); // Ownership to DAO
    }

    function setFeeRecipient(address feeRecipient_) external onlyOwner {
        require(feeRecipient_ != address(0), "invalid fee recipient");
        require(feeRecipient_ != feeRecipient, "already set");

        feeRecipient = feeRecipient_;
    }

    function setDefaultFeeNumerator(uint256 feeNumerator_) external onlyOwner {
        // TODO: Need a more sensible max limit here...
        require(feeNumerator_ != 0 && feeNumerator_ < 1e4, "invalid fee numerator");

        defaultFeeNumerator = feeNumerator_;
    }

    function setRTokenFeeNumerator(address rToken, uint256 feeNumerator_) external onlyOwner {
        // TODO: Need a more sensible max limit here...
        require(feeNumerator_ != 0 && feeNumerator_ < 1e4, "invalid fee numerator");

        rTokenFeeNumerator[rToken] = feeNumerator_;
    }

    function getFeeDetails(address rToken)
        external
        view
        returns (address recipient, uint256 feeNumerator)
    {
        recipient = feeRecipient;
        feeNumerator = rTokenFeeNumerator[rToken] == 0
            ? defaultFeeNumerator
            : rTokenFeeNumerator[rToken];
    }
}
