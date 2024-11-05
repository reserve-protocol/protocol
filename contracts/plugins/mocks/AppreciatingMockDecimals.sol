// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../assets/aave/ATokenFiatCollateral.sol";
import "../../libraries/Fixed.sol";
import "./ERC20MockDecimals.sol";

contract AppreciatingMockDecimals is ERC20MockDecimals {
    using FixLib for uint192;

    /// Emitted whenever a reward token balance is claimed
    event RewardsClaimed(IERC20 indexed erc20, uint256 indexed amount);

    address internal _underlyingToken;
    uint256 internal _exchangeRate;

    ERC20MockDecimals public rewardToken;
    mapping(address => uint256) public rewardBalances;

    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals,
        address underlyingToken
    ) ERC20MockDecimals(name, symbol, decimals) {
        _underlyingToken = underlyingToken;
        _exchangeRate = _toExchangeRate(FIX_ONE);
        require(
            decimals == ERC20MockDecimals(address(_underlyingToken)).decimals(),
            "invalid decimals"
        );
    }

    function underlying() external view returns (address) {
        return _underlyingToken;
    }

    function rate() external view returns (uint256) {
        return _exchangeRate;
    }

    function setExchangeRate(uint192 fiatcoinRedemptionRate) external {
        _exchangeRate = _toExchangeRate(fiatcoinRedemptionRate);
    }

    function _toExchangeRate(uint192 fiatcoinRedemptionRate) internal view returns (uint256) {
        /// From Compound Docs: The current exchange rate, scaled by 10^(18 - 8 + Underlying Token Decimals).
        if (decimals() <= 18) {
            int8 leftShift = 18 - int8(IERC20Metadata(_underlyingToken).decimals());
            return fiatcoinRedemptionRate.shiftl(leftShift);
        } else {
            return fiatcoinRedemptionRate.mulu_toUint(10**decimals(), ROUND);
        }
    }

    function setRewardToken(address rewardToken_) external {
        rewardToken = ERC20MockDecimals(rewardToken_);
    }

    function setRewards(address recipient, uint256 amount) external {
        rewardBalances[recipient] = amount;
    }

    function claimRewards() external {
        uint256 oldBal = rewardToken.balanceOf(msg.sender);
        if (address(rewardToken) != address(0) && rewardBalances[msg.sender] != 0) {
            rewardToken.mint(msg.sender, rewardBalances[msg.sender]);
            rewardBalances[msg.sender] = 0;
        }
        emit RewardsClaimed(
            IERC20(address(rewardToken)),
            rewardToken.balanceOf(msg.sender) - oldBal
        );
    }
}
