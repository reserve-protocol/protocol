// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import { RoleRegistry } from "./RoleRegistry.sol";

uint256 constant MAX_FEE_NUMERATOR = 15_00; // Max DAO Fee: 15%
uint256 constant FEE_DENOMINATOR = 100_00;

contract DAOFeeRegistry {
    RoleRegistry public roleRegistry;

    address private feeRecipient;
    uint256 private defaultFeeNumerator; // 0%

    mapping(address => uint256) private rTokenFeeNumerator;
    mapping(address => bool) private rTokenFeeSet;

    error DAOFeeRegistry__FeeRecipientAlreadySet();
    error DAOFeeRegistry__InvalidFeeRecipient();
    error DAOFeeRegistry__InvalidFeeNumerator();
    error DAOFeeRegistry__InvalidRoleRegistry();
    error DAOFeeRegistry__InvalidCaller();

    event FeeRecipientSet(address indexed feeRecipient);
    event DefaultFeeNumeratorSet(uint256 defaultFeeNumerator);
    event RTokenFeeNumeratorSet(address indexed rToken, uint256 feeNumerator, bool isActive);

    modifier onlyOwner() {
        if (!roleRegistry.isOwner(msg.sender)) {
            revert DAOFeeRegistry__InvalidCaller();
        }
        _;
    }

    constructor(RoleRegistry _roleRegistry, address _feeRecipient) {
        if (address(_roleRegistry) == address(0)) {
            revert DAOFeeRegistry__InvalidRoleRegistry();
        }

        roleRegistry = _roleRegistry;
        feeRecipient = _feeRecipient;
    }

    function setFeeRecipient(address feeRecipient_) external onlyOwner {
        if (feeRecipient_ == address(0)) {
            revert DAOFeeRegistry__InvalidFeeRecipient();
        }
        if (feeRecipient_ == feeRecipient) {
            revert DAOFeeRegistry__FeeRecipientAlreadySet();
        }

        feeRecipient = feeRecipient_;
        emit FeeRecipientSet(feeRecipient_);
    }

    function setDefaultFeeNumerator(uint256 feeNumerator_) external onlyOwner {
        if (feeNumerator_ > MAX_FEE_NUMERATOR) {
            revert DAOFeeRegistry__InvalidFeeNumerator();
        }

        defaultFeeNumerator = feeNumerator_;
        emit DefaultFeeNumeratorSet(defaultFeeNumerator);
    }

    /// @dev A fee below 1% not recommended due to poor precision in the Distributor
    function setRTokenFeeNumerator(address rToken, uint256 feeNumerator_) external onlyOwner {
        if (feeNumerator_ > MAX_FEE_NUMERATOR) {
            revert DAOFeeRegistry__InvalidFeeNumerator();
        }

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
