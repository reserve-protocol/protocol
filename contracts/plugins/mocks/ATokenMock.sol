// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../assets/aave/ATokenFiatCollateral.sol";
import "../../libraries/Fixed.sol";
import "./ERC20Mock.sol";

// This is the inner, rebasing ERC. It's not what we interact with.
contract ATokenMock is ERC20Mock {
    address internal _underlyingAsset;

    constructor(
        string memory name,
        string memory symbol,
        address underlyingAsset
    ) ERC20Mock(name, symbol) {
        _underlyingAsset = underlyingAsset;
    }

    // solhint-disable-next-line func-name-mixedcase
    function UNDERLYING_ASSET_ADDRESS() external view returns (address) {
        return _underlyingAsset;
    }
}

// This is the non-rebasing wrapper, which is what we care about.
contract StaticATokenMock is ERC20Mock {
    using FixLib for uint192;

    /// Emitted whenever a reward token balance is claimed
    event RewardsClaimed(IERC20 indexed erc20, uint256 indexed amount);

    ATokenMock internal aToken;

    uint256 internal _exchangeRate;

    // Mock mappings to set and claim AAVE Tokens
    mapping(address => uint256) public aaveBalances;

    ERC20Mock public aaveToken;

    constructor(
        string memory name,
        string memory symbol,
        address underlyingAsset
    ) ERC20Mock(name, symbol) {
        aToken = new ATokenMock(name, symbol, underlyingAsset);

        // In Aave all rates are in {RAYs/tok}, and they are independent of the underlying's decimals
        _exchangeRate = _toExchangeRate(FIX_ONE);
    }

    function decimals() public pure override returns (uint8) {
        return 18;
    }

    function rate() external view returns (uint256) {
        return _exchangeRate;
    }

    function setExchangeRate(uint192 fiatcoinRedemptionRate) external {
        _exchangeRate = _toExchangeRate(fiatcoinRedemptionRate);
    }

    function setAaveToken(address aaveToken_) external {
        aaveToken = ERC20Mock(aaveToken_);
    }

    //solhint-disable-next-line func-name-mixedcase
    function ATOKEN() external view returns (ATokenMock) {
        return aToken;
    }

    //solhint-disable-next-line func-name-mixedcase
    function REWARD_TOKEN() external view returns (IERC20) {
        return aaveToken;
    }

    function setRewards(address recipient, uint256 amount) external {
        aaveBalances[recipient] = amount;
    }

    function claimRewardsToSelf(bool) external {
        if (address(aaveToken) != address(0) && aaveBalances[msg.sender] != 0) {
            aaveToken.mint(msg.sender, aaveBalances[msg.sender]);
            aaveBalances[msg.sender] = 0;
        }
    }

    function getClaimableRewards(address user) external view returns (uint256) {
        return aaveBalances[user];
    }

    function _toExchangeRate(uint192 fiatcoinRedemptionRate) internal pure returns (uint256) {
        return fiatcoinRedemptionRate.mulu_toUint(1e27, ROUND);
    }

    function claimRewards() external {
        uint256 oldBal = aaveToken.balanceOf(msg.sender);
        if (address(aaveToken) != address(0) && aaveBalances[msg.sender] != 0) {
            aaveToken.mint(msg.sender, aaveBalances[msg.sender]);
            aaveBalances[msg.sender] = 0;
        }
        emit RewardsClaimed(IERC20(address(aaveToken)), aaveToken.balanceOf(msg.sender) - oldBal);
    }
}
