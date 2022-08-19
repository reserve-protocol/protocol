// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

import "contracts/interfaces/IAsset.sol";
import "contracts/plugins/assets/Asset.sol";
import "contracts/fuzz/Utils.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/fuzz/OracleErrorMock.sol";
import "contracts/fuzz/PriceModel.sol";
import "contracts/fuzz/RewarderMock.sol";

contract AssetMock is OracleErrorMock, Asset {
    using FixLib for uint192;
    using PriceModelLib for PriceModel;

    event SetPrice(string symbol, uint192 price);
    PriceModel public model;
    uint256 public rewardAmount;

    constructor(
        IERC20Metadata erc20_,
        IERC20Metadata rewardERC20_,
        uint256 rewardAmount_,
        TradingRange memory tradingRange_,
        PriceModel memory model_,
        address rewarder_
    )
        Asset(
            AggregatorV3Interface(address(1)), // stub out the expected chainlink oracle
            erc20_,
            rewardERC20_, // no reward token
            tradingRange_,
            1 // stub out oracleTimeout
        )
    {
        model = model_;
        rewardAmount = rewardAmount_;
        emit SetPrice(erc20.symbol(), model.price());
    }

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function price(AggregatorV3Interface, uint32) internal view virtual override returns (uint192) {
        maybeFail();
        return model.price();
    }

    function update(uint256 seed) public {
        model.update(uint192(seed));
        emit SetPrice(erc20.symbol(), model.price());
    }

    // ==== Rewards ====
    function updateRewardAmount(uint256 amount) public {
        rewardAmount = amount % 1e29;
    }

    function getClaimCalldata() public view virtual override returns (address to, bytes memory cd) {
        if (rewarder != address(0)) {
            to = rewarder;
            cd = abi.encodeWithSignature("claimRewards(address)", address(this), msg.sender);
        }
    }

    function claimRewards(address who) public override {
        if (address(rewardERC20) == address(0)) return; // no rewards if no reward token
        if (erc20.balanceOf(who) == 0) return; // no rewards to non-holders
        if (rewardAmount == 0) return; // no rewards if rewards are zero

        ERC20Fuzz(address(rewardERC20)).mint(who, rewardAmount);
        require(rewardERC20.totalSupply() <= 1e29, "Exceeded reasonable maximum of reward tokens");
    }
}
