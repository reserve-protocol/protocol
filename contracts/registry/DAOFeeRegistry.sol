// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

uint256 constant FEE_DENOMINATOR = 100_00;

contract DAOFeeRegistry is Ownable {
    address private feeRecipient;
    uint256 private defaultFeeNumerator; // 1e4 = 100% fee

    mapping(address => uint256) private rTokenFeeNumerator;
    mapping(address => bool) private rTokenFeeSet;

    event FeeRecipientSet(address indexed feeRecipient);
    event DefaultFeeNumeratorSet(uint256 defaultFeeNumerator);
    event RTokenFeeNumeratorSet(address indexed rToken, uint256 feeNumerator, bool isActive);

    constructor(address owner_) Ownable() {
        _transferOwnership(owner_); // Ownership to DAO
    }

    function setFeeRecipient(address feeRecipient_) external onlyOwner {
        require(feeRecipient_ != address(0), "invalid fee recipient");
        require(feeRecipient_ != feeRecipient, "already set");

        feeRecipient = feeRecipient_;
        emit FeeRecipientSet(feeRecipient_);
    }

    function setDefaultFeeNumerator(uint256 feeNumerator_) external onlyOwner {
        // TODO: Need a more sensible max limit here...
        require(feeNumerator_ < FEE_DENOMINATOR, "invalid fee numerator");

        defaultFeeNumerator = feeNumerator_;
        emit DefaultFeeNumeratorSet(defaultFeeNumerator);
    }

    function setRTokenFeeNumerator(address rToken, uint256 feeNumerator_) external onlyOwner {
        // TODO: Need a more sensible max limit here...
        require(feeNumerator_ < FEE_DENOMINATOR, "invalid fee numerator");

        rTokenFeeNumerator[rToken] = feeNumerator_;
        rTokenFeeSet[rToken] = true;
        emit RTokenFeeNumeratorSet(rToken, feeNumerator_, true);
    }

    function resetRTokenFee(address rToken) external onlyOwner {
        rTokenFeeNumerator[rToken] = 0;
        rTokenFeeSet[rToken] = false;

        emit RTokenFeeNumeratorSet(rToken, 0, false);
    }

    function getFeeDetails(address rToken)
        external
        view
        returns (
            address recipient,
            uint256 feeNumerator,
            uint256 feeDenominator
        )
    {
        recipient = feeRecipient;
        feeNumerator = rTokenFeeSet[rToken] ? rTokenFeeNumerator[rToken] : defaultFeeNumerator;
        feeDenominator = FEE_DENOMINATOR;
    }
}
