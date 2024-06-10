// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

uint256 constant MAX_FEE_NUMERATOR = 15_00; // max 15% DAO fee
uint256 constant FEE_DENOMINATOR = 100_00;

contract DAOFeeRegistry is Ownable {
    address private feeRecipient;
    uint256 private defaultFeeNumerator; // 0%

    mapping(address => uint256) private rTokenFeeNumerator;
    mapping(address => bool) private rTokenFeeSet;

    error DAOFeeRegistry__FeeRecipientAlreadySet();
    error DAOFeeRegistry__InvalidFeeRecipient();
    error DAOFeeRegistry__InvalidFeeNumerator();

    event FeeRecipientSet(address indexed feeRecipient);
    event DefaultFeeNumeratorSet(uint256 defaultFeeNumerator);
    event RTokenFeeNumeratorSet(address indexed rToken, uint256 feeNumerator, bool isActive);

    constructor(address owner_) Ownable() {
        _transferOwnership(owner_); // Ownership to DAO
        feeRecipient = owner_; // DAO as initial fee recipient
    }

    function setFeeRecipient(address feeRecipient_) external onlyOwner {
        if (feeRecipient_ == address(0)) revert DAOFeeRegistry__InvalidFeeRecipient();
        if (feeRecipient_ == feeRecipient) revert DAOFeeRegistry__FeeRecipientAlreadySet();

        feeRecipient = feeRecipient_;
        emit FeeRecipientSet(feeRecipient_);
    }

    function setDefaultFeeNumerator(uint256 feeNumerator_) external onlyOwner {
        if (feeNumerator_ > MAX_FEE_NUMERATOR) revert DAOFeeRegistry__InvalidFeeNumerator();

        defaultFeeNumerator = feeNumerator_;
        emit DefaultFeeNumeratorSet(defaultFeeNumerator);
    }

    function setRTokenFeeNumerator(address rToken, uint256 feeNumerator_) external onlyOwner {
        if (feeNumerator_ > MAX_FEE_NUMERATOR) revert DAOFeeRegistry__InvalidFeeNumerator();

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
