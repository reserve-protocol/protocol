// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "../mixins/ZapInBaseV3_1.sol";
import "../mixins/ZapOutBaseV3_1.sol";

// solhint-disable const-name-snakecase, event-name-camelcase, func-name-mixedcase

contract RTokenZapV1 is ZapInBaseV3_1, ZapOutBaseV3_1 {
    using SafeERC20 for IERC20;

    address private constant wethTokenAddress = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address private constant cETH = 0x4Ddc2D193948926D02f9B1fE9e1daa0718270ED5;

    constructor(uint256 _goodwill, uint256 _affiliateSplit)
        ZapBaseV2_1(_goodwill, _affiliateSplit)
    {
        // 0x
        approvedTargets[0xDef1C0ded9bec7F1a1670819833240f027b25EfF] = true;
    }

    event zapIn(address sender, address token, uint256 tokensRec);
    event zapOut(address sender, address token, uint256 tokensRec);

    function getReferenceToken(address collateralToken)
        public
        view
        returns (address referenceToken)
    {
        // TODO: Impl
        return address(0);
    }

    function getCollateralToken(address rToken) public view returns (address collateralToken) {
        // TODO: Impl
        return address(0);
    }

    function _enterReserve(
        address collateralToken,
        uint256 collateralTokenAmount,
        address rToken
    ) internal returns (uint256 rTokenAmount) {
        if (collateralToken == address(0)) {
            // TODO: Impl for ETH
        } else {
            _approveToken(collateralToken, rToken, collateralTokenAmount);
            // TODO: Impl for collateral tokens
        }
        return 0;
    }

    function _exitReserve(
        address rToken,
        uint256 rTokenAmount,
        address collateralToken
    ) internal pure returns (uint256 collateralTokenAmount) {
        if (collateralToken == address(0)) {
            // TODO: Impl
        } else {
            // TODO: Check if throttled?
        }
        return 0;
    }

    /**
    @notice This function deposits assets into Reserve with ETH or ERC20 tokens
    @param fromToken The token used for entry (address(0) if ether)
    @param amountIn The amount of fromToken to invest
    @param rToken Address of the rToken
    @param minrTokens The minimum acceptable quantity rTokens to receive. Reverts otherwise
    @param swapTarget Excecution target for the swap or zap
    @param swapData DEX or Zap data. Must swap to rToken underlying address
    @param affiliate Affiliate address
    @return rTokenAmount Quantity of rTokens received
     */
    function ZapIn(
        address fromToken,
        uint256 amountIn,
        address rToken,
        uint256 minrTokens,
        address swapTarget,
        bytes calldata swapData,
        address affiliate
    ) external payable stopInEmergency returns (uint256 rTokenAmount) {
        amountIn = _pullTokens(fromToken, amountIn, affiliate, true);

        // Use 0x to swap fromToken to referenceToken
        address referenceToken = getReferenceToken(rToken);
        uint256 referenceTokenAmount = _fillQuote(
            fromToken,
            referenceToken,
            amountIn,
            swapTarget,
            swapData
        );

        address cToken = getCollateralToken(rToken);
        uint256 collateralTokenAmount = _enterCompound(
            referenceToken,
            referenceTokenAmount,
            cToken
        );

        rTokenAmount = _enterReserve(cToken, collateralTokenAmount, rToken);
        require(rTokenAmount > minrTokens, "High Slippage");

        IERC20(rToken).safeTransfer(msg.sender, rTokenAmount);

        emit zapIn(msg.sender, rToken, rTokenAmount);
    }

    /**
    @notice This function withdraws assets from Reserve, receiving tokens or ETH
    @param rToken The rToken being withdrawn
    @param amountIn The quantity of fromrToken to withdraw
    @param outToken Address of the token to receive (0 address if ETH)
    @param minOutTokens The minimum acceptable quantity tokens to receive. Reverts otherwise
    @param swapTarget Excecution target for the swap or zap
    @param swapData DEX or Zap data
    @param affiliate Affiliate address
    @return outTokenAmount Quantity of outToken received
     */
    function ZapOut(
        address rToken,
        uint256 amountIn,
        address outToken,
        uint256 minOutTokens,
        address swapTarget,
        bytes calldata swapData,
        address affiliate
    ) public stopInEmergency returns (uint256 outTokenAmount) {
        amountIn = _pullTokens(rToken, amountIn);

        address collateralToken = getCollateralToken(rToken);
        uint256 collateralTokenAmount = _exitReserve(rToken, amountIn, collateralToken);

        address referenceToken = getReferenceToken(collateralToken);
        uint256 referenceTokenAmount = _exitCompound(
            collateralToken,
            collateralTokenAmount,
            referenceToken
        );

        // Use 0x to swap referenceToken to outToken
        outTokenAmount = _fillQuote(
            referenceToken,
            outToken,
            referenceTokenAmount,
            swapTarget,
            swapData
        );

        require(outTokenAmount >= minOutTokens, "High Slippage");

        uint256 totalGoodwillPortion;

        if (referenceToken == address(0)) {
            totalGoodwillPortion = _subtractGoodwill(ETHAddress, outTokenAmount, affiliate, true);

            payable(msg.sender).transfer(outTokenAmount - totalGoodwillPortion);
        } else {
            totalGoodwillPortion = _subtractGoodwill(
                referenceToken,
                outTokenAmount,
                affiliate,
                true
            );

            IERC20(referenceToken).safeTransfer(msg.sender, outTokenAmount - totalGoodwillPortion);
        }

        outTokenAmount -= totalGoodwillPortion;

        emit zapOut(msg.sender, referenceToken, outTokenAmount);
    }

    function _enterCompound(
        address referenceToken,
        uint256 referenceTokenAmount,
        address collateralToken
    ) internal returns (uint256 collateralTokenAmount) {
        uint256 initialBalance = _getBalance(collateralToken);

        if (referenceToken == address(0)) {
            ICompoundToken(collateralToken).mint{ value: referenceTokenAmount }();
        } else {
            _approveToken(referenceToken, collateralToken, referenceTokenAmount);
            ICompoundToken(collateralToken).mint(referenceTokenAmount);
        }

        collateralTokenAmount = _getBalance(collateralToken) - initialBalance;
    }

    function _exitCompound(
        address collateralToken,
        uint256 collateralTokenAmount,
        address referenceToken
    ) internal returns (uint256 referenceTokenAmount) {
        uint256 initialBalance = _getBalance(referenceToken);

        ICompoundToken(collateralToken).redeem(collateralTokenAmount);

        referenceTokenAmount = _getBalance(referenceToken) - initialBalance;
    }

    function _fillQuote(
        address fromToken,
        address toToken,
        uint256 _amount,
        address swapTarget,
        bytes memory swapData
    ) internal returns (uint256 amountBought) {
        if (fromToken == toToken) {
            return _amount;
        }

        if (fromToken == address(0) && toToken == wethTokenAddress) {
            IWETH(wethTokenAddress).deposit{ value: _amount }();
            return _amount;
        }

        if (fromToken == wethTokenAddress && toToken == address(0)) {
            IWETH(wethTokenAddress).withdraw(_amount);
            return _amount;
        }

        uint256 valueToSend;
        if (fromToken == address(0)) {
            valueToSend = _amount;
        } else {
            _approveToken(fromToken, swapTarget);
        }

        uint256 initialBalance = _getBalance(toToken);

        require(approvedTargets[swapTarget], "Target not Authorized");
        // solhint-disable-next-line avoid-low-level-calls
        (bool success, ) = swapTarget.call{ value: valueToSend }(swapData);
        require(success, "Error Swapping Tokens");

        amountBought = _getBalance(toToken) - initialBalance;

        require(amountBought > 0, "Swapped To Invalid Intermediate");
    }
}

interface ICompoundToken {
    function underlying() external view returns (address);

    function mint(uint256 mintAmount) external returns (uint256);

    function mint() external payable;

    function redeem(uint256 redeemTokens) external returns (uint256);

    function exchangeRateStored() external view returns (uint256);
}

interface IWETH {
    function deposit() external payable;

    function transfer(address to, uint256 value) external returns (bool);

    function withdraw(uint256) external;
}
