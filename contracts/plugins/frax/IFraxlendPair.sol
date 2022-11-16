// SPDX-License-Identifier: ISC
pragma solidity >=0.8.9;
// solhint-disable
interface IFraxlendPair {
    function CIRCUIT_BREAKER_ADDRESS() external view returns (address);

    function COMPTROLLER_ADDRESS() external view returns (address);

    function DEPLOYER_ADDRESS() external view returns (address);

    function FRAXLEND_WHITELIST_ADDRESS() external view returns (address);

    function TIME_LOCK_ADDRESS() external view returns (address);

    function addCollateral(uint256 _collateralAmount, address _borrower) external;

    function addInterest()
        external
        returns (
            uint256 _interestEarned,
            uint256 _feesAmount,
            uint256 _feesShare,
            uint64 _newRate
        );

    function allowance(address owner, address spender) external view returns (uint256);

    function approve(address spender, uint256 amount) external returns (bool);

    function approvedBorrowers(address) external view returns (bool);

    function approvedLenders(address) external view returns (bool);

    function asset() external view returns (address);

    function balanceOf(address account) external view returns (uint256);

    function borrowAsset(
        uint256 _borrowAmount,
        uint256 _collateralAmount,
        address _receiver
    ) external returns (uint256 _shares);

    function borrowerWhitelistActive() external view returns (bool);

    function changeFee(uint32 _newFee) external;

    function cleanLiquidationFee() external view returns (uint256);

    function collateralContract() external view returns (address);

    function currentRateInfo()
        external
        view
        returns (
            uint64 lastBlock,
            uint64 feeToProtocolRate,
            uint64 lastTimestamp,
            uint64 ratePerSec
        );

    function decimals() external pure returns (uint8);

    function decreaseAllowance(address spender, uint256 subtractedValue) external returns (bool);

    function deposit(uint256 _amount, address _receiver) external returns (uint256 _sharesReceived);

    function dirtyLiquidationFee() external view returns (uint256);

    function exchangeRateInfo() external view returns (uint32 lastTimestamp, uint224 exchangeRate);

    function getConstants()
        external
        pure
        returns (
            uint256 _LTV_PRECISION,
            uint256 _LIQ_PRECISION,
            uint256 _UTIL_PREC,
            uint256 _FEE_PRECISION,
            uint256 _EXCHANGE_PRECISION,
            uint64 _DEFAULT_INT,
            uint16 _DEFAULT_PROTOCOL_FEE,
            uint256 _MAX_PROTOCOL_FEE
        );

    function increaseAllowance(address spender, uint256 addedValue) external returns (bool);

    function initialize(
        string calldata _name,
        address[] calldata _approvedBorrowers,
        address[] calldata _approvedLenders,
        bytes calldata _rateInitCallData
    ) external;

    function lenderWhitelistActive() external view returns (bool);

    function leveragedPosition(
        address _swapperAddress,
        uint256 _borrowAmount,
        uint256 _initialCollateralAmount,
        uint256 _amountCollateralOutMin,
        address[] calldata _path
    ) external returns (uint256 _totalCollateralBalance);

    function liquidate(
        uint128 _sharesToLiquidate,
        uint256 _deadline,
        address _borrower
    ) external returns (uint256 _collateralForLiquidator);

    function maturityDate() external view returns (uint256);

    function maxLTV() external view returns (uint256);

    function name() external view returns (string calldata);

    function oracleDivide() external view returns (address);

    function oracleMultiply() external view returns (address);

    function oracleNormalization() external view returns (uint256);

    function owner() external view returns (address);

    function pause() external;

    function paused() external view returns (bool);

    function penaltyRate() external view returns (uint256);

    function rateContract() external view returns (address);

    function rateInitCallData() external view returns (bytes calldata);

    function redeem(
        uint256 _shares,
        address _receiver,
        address _owner
    ) external returns (uint256 _amountToReturn);

    function removeCollateral(uint256 _collateralAmount, address _receiver) external;

    function renounceOwnership() external;

    function repayAsset(uint256 _shares, address _borrower) external returns (uint256 _amountToRepay);

    function repayAssetWithCollateral(
        address _swapperAddress,
        uint256 _collateralToSwap,
        uint256 _amountAssetOutMin,
        address[] calldata _path
    ) external returns (uint256 _amountAssetOut);

    function setApprovedBorrowers(address[] calldata _borrowers, bool _approval) external;

    function setApprovedLenders(address[] calldata _lenders, bool _approval) external;

    function setSwapper(address _swapper, bool _approval) external;

    function setTimeLock(address _newAddress) external;

    function swappers(address) external view returns (bool);

    function symbol() external view returns (string calldata);

    function toAssetAmount(uint256 _shares, bool _roundUp) external view returns (uint256);

    function toBorrowAmount(uint256 _shares, bool _roundUp) external view returns (uint256);

    function toBorrowShares(uint256 _amount, bool _roundUp) external view returns (uint256);

    function totalAsset() external view returns (uint128 amount, uint128 shares);

    function totalBorrow() external view returns (uint128 amount, uint128 shares);

    function totalCollateral() external view returns (uint256);

    function totalSupply() external view returns (uint256);

    function transfer(address to, uint256 amount) external returns (bool);

    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external returns (bool);

    function transferOwnership(address newOwner) external;

    function unpause() external;

    function updateExchangeRate() external returns (uint256 _exchangeRate);

    function userBorrowShares(address) external view returns (uint256);

    function userCollateralBalance(address) external view returns (uint256);

    function version() external view returns (string calldata);

    function withdrawFees(uint128 _shares, address _recipient) external returns (uint256 _amountToTransfer);
}
