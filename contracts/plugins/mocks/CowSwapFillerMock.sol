// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.28;

import { SafeERC20, IERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import "@reserve-protocol/trusted-fillers/contracts/interfaces/IBaseTrustedFiller.sol";

// Mock constants equivalent to CowSwap's
address constant GPV2_SETTLEMENT = 0x9008D19f58AAbD9eD0D60971565AA8510560ab41;
address constant GPV2_VAULT_RELAYER = 0xC92E8bdf79f0507f65a392b0ab4667716BFE0110;
uint256 constant D27 = 1e27;

// Simplified GPv2Order data for testing
struct MockGPv2Order {
    IERC20 sellToken;
    IERC20 buyToken;
    address receiver;
    uint256 sellAmount;
    uint256 buyAmount;
    uint256 feeAmount;
    uint32 validTo;
    bytes32 appData;
    bytes32 kind; // "sell" or "buy" as bytes32
    bool partiallyFillable;
    bytes32 sellTokenBalance; // "erc20" as bytes32
    bytes32 buyTokenBalance; // "erc20" as bytes32
}

/// Mock CowSwap Filler that mirrors the actual CowSwapFiller behavior
/// Compatible with OpenZeppelin 4.9.6 (uses Math.Rounding.Up instead of Math.Rounding.Up)
/// MUST be cloned via TrustedFillerRegistry to work properly
contract CowSwapFillerMock is Initializable, IBaseTrustedFiller {
    using SafeERC20 for IERC20;

    error CowSwapFiller__Unauthorized();
    error CowSwapFiller__OrderCheckFailed(uint256 errorCode);

    address public fillCreator;
    IERC20 public sellToken;
    IERC20 public buyToken;
    uint256 public sellAmount; // {sellTok}
    uint256 public blockInitialized; // {block}
    uint256 public price; // D27{buyTok/sellTok}
    bool public partiallyFillable;

    // mock: allow to force swapActive on tests
    bool public forceSwapActive;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// Initialize the swap, transferring in `_sellAmount` of the `_sell` token
    /// @dev Built for the pre-hook of a CowSwap order, must be called via using entity
    function initialize(
        address _creator,
        IERC20 _sellToken,
        IERC20 _buyToken,
        uint256 _sellAmount,
        uint256 _minBuyAmount
    ) external initializer {
        fillCreator = _creator;
        sellToken = _sellToken;
        buyToken = _buyToken;
        sellAmount = _sellAmount;
        blockInitialized = block.number;
        partiallyFillable = true;

        // D27{buyTok/sellTok} = {buyTok} * D27 / {sellTok}
        // Using Ceil instead of Up for OZ 4.9.6 compatibility
        price = Math.mulDiv(_minBuyAmount, D27, _sellAmount, Math.Rounding.Up);

        // Mock approval - in real CowSwap this would be the vault relayer
        sellToken.forceApprove(GPV2_VAULT_RELAYER, _sellAmount);
        sellToken.safeTransferFrom(_creator, address(this), _sellAmount);
    }

    /// @dev Validates CowSwap order for a fill via EIP-1271
    /// Simplified mock version that validates basic order structure
    function isValidSignature(bytes32, bytes calldata signature) external view returns (bytes4) {
        require(block.number == blockInitialized, CowSwapFiller__Unauthorized());

        // In a real implementation, we'd decode the full GPv2Order from signature
        // For testing, we just validate that we have the right tokens and amounts
        // Ignoring partially fillable condition
        if (signature.length > 0) {
            // Mock validation - assume order is valid if we have a signature
            return this.isValidSignature.selector; // 0x1626ba7e
        }

        revert CowSwapFiller__OrderCheckFailed(0);
    }

    /// @return true if the contract is mid-swap and funds have not yet settled
    function swapActive() public view returns (bool) {
        // mock: used for testing
        if (forceSwapActive) {
            return true;
        }

        if (block.number != blockInitialized) {
            return false;
        }

        uint256 sellTokenBalance = sellToken.balanceOf(address(this));
        if (sellTokenBalance >= sellAmount) {
            return false;
        }

        // {buyTok} = {sellTok} * D27{buyTok/sellTok} / D27
        // Using Ceil instead of Up for OZ 4.9.6 compatibility
        uint256 minimumExpectedIn = Math.mulDiv(
            sellAmount - sellTokenBalance,
            price,
            D27,
            Math.Rounding.Up
        );

        return minimumExpectedIn > buyToken.balanceOf(address(this));
    }

    /// Collect all balances back to the beneficiary
    function closeFiller() external {
        if (swapActive()) revert BaseTrustedFiller__SwapActive();
        rescueToken(sellToken);
        rescueToken(buyToken);
    }

    function setPartiallyFillable(bool _partiallyFillable) external {
        require(msg.sender == fillCreator, CowSwapFiller__Unauthorized());
        require(block.number == blockInitialized, CowSwapFiller__Unauthorized());

        partiallyFillable = _partiallyFillable;
    }

    /// Rescue tokens in case any are left in the contract
    function rescueToken(IERC20 token) public {
        uint256 tokenBalance = token.balanceOf(address(this));
        if (tokenBalance != 0) {
            token.safeTransfer(fillCreator, tokenBalance);
        }
    }

    /// Mock: Setter for forceSwapActive
    function setForceSwapActive(bool _forceSwapActive) external {
        forceSwapActive = _forceSwapActive;
    }
}
