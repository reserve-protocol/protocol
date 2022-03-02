// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/plugins/assets/ATokenFiatCollateral.sol";
import "contracts/libraries/Fixed.sol";
import "./ERC20Mock.sol";

// This is the inner, rebasing ERC. It's not what we interact with.
contract ATokenMock is ERC20Mock {
    address internal immutable _underlyingAsset;

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
    using FixLib for Fix;

    ATokenMock internal immutable aToken;

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

    function setExchangeRate(Fix fiatcoinRedemptionRate) external {
        _exchangeRate = _toExchangeRate(fiatcoinRedemptionRate);
    }

    function setAaveToken(address aaveToken_) external {
        aaveToken = ERC20Mock(aaveToken_);
    }

    //solhint-disable-next-line func-name-mixedcase
    function ATOKEN() external view returns (ATokenMock) {
        return aToken;
    }

    function setRewards(address recipient, uint256 amount) external {
        aaveBalances[recipient] = amount;
    }

    function claimRewardsToSelf(bool) external {
        // Mint amount and update internal balances
        if (address(aaveToken) != address(0) && aaveBalances[msg.sender] > 0) {
            aaveToken.mint(msg.sender, aaveBalances[msg.sender]);
            aaveBalances[msg.sender] = 0;
        }
    }

    function getClaimableRewards(address user) external view returns (uint256) {
        return aaveBalances[user];
    }

    function _toExchangeRate(Fix fiatcoinRedemptionRate) internal pure returns (uint256) {
        return fiatcoinRedemptionRate.mulu(1e27).round();
    }
}
