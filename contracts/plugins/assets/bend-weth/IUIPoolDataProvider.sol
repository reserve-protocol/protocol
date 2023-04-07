// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.17;

import {ILendPoolAddressesProvider} from "./ILendPoolAddressesProvider.sol";
import {IIncentivesController} from "./IIncentivesController.sol";

interface IUiPoolDataProvider {
  struct AggregatedReserveData {
    address underlyingAsset;
    string name;
    string symbol;
    uint256 decimals;
    uint256 reserveFactor;
    bool borrowingEnabled;
    bool isActive;
    bool isFrozen;
    // base data
    uint128 liquidityIndex;
    uint128 variableBorrowIndex;
    uint128 liquidityRate;
    uint128 variableBorrowRate;
    uint40 lastUpdateTimestamp;
    address bTokenAddress;
    address debtTokenAddress;
    address interestRateAddress;
    //
    uint256 availableLiquidity;
    uint256 totalVariableDebt;
    uint256 priceInEth;
    uint256 variableRateSlope1;
    uint256 variableRateSlope2;
  }

  struct UserReserveData {
    address underlyingAsset;
    uint256 bTokenBalance;
    uint256 variableDebt;
  }

  struct AggregatedNftData {
    address underlyingAsset;
    string name;
    string symbol;
    uint256 ltv;
    uint256 liquidationThreshold;
    uint256 liquidationBonus;
    uint256 redeemDuration;
    uint256 auctionDuration;
    uint256 redeemFine;
    uint256 redeemThreshold;
    uint256 minBidFine;
    bool isActive;
    bool isFrozen;
    address bNftAddress;
    uint256 priceInEth;
    uint256 totalCollateral;
  }

  struct UserNftData {
    address underlyingAsset;
    address bNftAddress;
    uint256 totalCollateral;
  }

  struct AggregatedLoanData {
    uint256 loanId;
    uint256 state;
    address reserveAsset;
    uint256 totalCollateralInReserve;
    uint256 totalDebtInReserve;
    uint256 availableBorrowsInReserve;
    uint256 healthFactor;
    uint256 liquidatePrice;
    address bidderAddress;
    uint256 bidPrice;
    uint256 bidBorrowAmount;
    uint256 bidFine;
  }

  function getReservesList(ILendPoolAddressesProvider provider) external view returns (address[] memory);

  function getSimpleReservesData(ILendPoolAddressesProvider provider)
    external
    view
    returns (AggregatedReserveData[] memory);

  function getUserReservesData(ILendPoolAddressesProvider provider, address user)
    external
    view
    returns (UserReserveData[] memory);

  // generic method with full data
  function getReservesData(ILendPoolAddressesProvider provider, address user)
    external
    view
    returns (AggregatedReserveData[] memory, UserReserveData[] memory);

  function getNftsList(ILendPoolAddressesProvider provider) external view returns (address[] memory);

  function getSimpleNftsData(ILendPoolAddressesProvider provider) external view returns (AggregatedNftData[] memory);

  function getUserNftsData(ILendPoolAddressesProvider provider, address user)
    external
    view
    returns (UserNftData[] memory);

  // generic method with full data
  function getNftsData(ILendPoolAddressesProvider provider, address user)
    external
    view
    returns (AggregatedNftData[] memory, UserNftData[] memory);

  function getSimpleLoansData(
    ILendPoolAddressesProvider provider,
    address[] memory nftAssets,
    uint256[] memory nftTokenIds
  ) external view returns (AggregatedLoanData[] memory);
}