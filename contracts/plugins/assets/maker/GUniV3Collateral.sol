// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/presets/ERC20PresetMinterPauser.sol";
import "../../../libraries/Fixed.sol";
import "../FiatCollateral.sol";
import "../OracleLib.sol";
import "./Vat.sol";
import "./GemJoin.sol";

/**
 * @title GUniV3Collateral
 * @notice Collateral plugin for GUniV3Collaterals (Maker EARN 50x on Uniswap pools),
 * tok = GUNIV3DAIUSDC1 | GUNIV3DAIUSDC2
 * ref = DAI // we do consider DAI as the reference asset and a mix of USDC and DAI. However, both DAI and USDC pegs to USD are checked.
 * tar = DAI
 * UoA = USD
 */
contract GUniV3Collateral is FiatCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    
    struct Ilk {
        uint256 Art;   // Total Normalised Debt     [wad]
        uint256 rate;  // Accumulated Rates         [ray]
        uint256 spot;  // Price with Safety Margin  [ray]
        uint256 line;  // Debt Ceiling              [rad]
        uint256 dust;  // Urn Debt Floor            [rad]
    }

    bytes32 public immutable poolIlk;
    address public immutable mcdVat;
    address public immutable mcdGemJoin;
    ERC20PresetMinterPauser public immutable wrapperToken;
    AggregatorV3Interface public immutable usdcFeed;

    uint192 public immutable usdcPegBottom; // {target/ref} The bottom of the peg

    uint192 public immutable usdcPegTop; // {target/ref} The top of the peg


    /// @param config.chainlinkFeed Feed units: {UoA/ref}
    constructor(
        CollateralConfig memory config,
        bytes32 _poolIlk, // a bytes32 identifier for the pool
        address _mcdVat,  // maker's vault contract
        address _mcdGemJoin, // maker's gem join contract
        ERC20PresetMinterPauser  _wrapperToken,
        AggregatorV3Interface _usdcFeed
    ) FiatCollateral(config) {
        require(_poolIlk[0] != 0, "poolIlk = 0");
        require(_mcdVat != address(0), "mcdVat = 0");
        require(_mcdGemJoin != address(0), "mcdGemJoin = 0");
        require(address(_wrapperToken) != address(0), "wrapperToken = 0");
        require(address(_usdcFeed) != address(0), "usdcFeed = 0");
        poolIlk = _poolIlk;
        mcdVat = _mcdVat;
        mcdGemJoin = _mcdGemJoin;
        wrapperToken = _wrapperToken;
        usdcFeed = _usdcFeed;

        // Cache constants
        uint192 peg = targetPerRef(); // {target/ref}

        // {target/ref} = {target/ref} * {1}
        uint192 delta = peg.mul(config.defaultThreshold);
        usdcPegBottom = peg - delta;
        usdcPegTop = peg + delta;
        
        
    }

    /// Should not revert
    /// Refresh exchange rates and update default status.
    /// Original function overriden to check the USDC peg as well.
    /// @dev May need to override: limited to handling collateral with refPerTok() = 1
    function refresh() public virtual override {
        if (alreadyDefaulted()) return;
        CollateralStatus oldStatus = status();

        // Check for soft default + save lotPrice
        try this.tryPrice() returns (uint192 low, uint192 high, uint192 pegPrice) {
            // {UoA/tok}, {UoA/tok}, {target/ref}
            // (0, 0) is a valid price; (0, FIX_MAX) is unpriced

            // Save prices if priced
            if (high < FIX_MAX) {
                savedLowPrice = low;
                savedHighPrice = high;
                lastSave = uint48(block.timestamp);
            } else {
                // must be unpriced
                assert(low == 0);
            }

            // try usdc chainlink feed and evaluate it's peg
            try this.usdcPrice() returns (uint192 usdcPrice) {
                // {UoA/ref}
                // If the price is below the default-threshold price, default eventually
                // uint192(+/-) is the same as Fix.plus/minus
                if (usdcPrice < usdcPegBottom || usdcPrice > usdcPegTop) {
                    markStatus(CollateralStatus.IFFY);
                } else {
                    markStatus(CollateralStatus.SOUND);
                }
            } catch (bytes memory errData) {
                // see: docs/solidity-style.md#Catching-Empty-Data
                if (errData.length == 0) revert(); // solhint-disable-line reason-string
                markStatus(CollateralStatus.IFFY);
            }

            // If the price is below the default-threshold price, default eventually
            // uint192(+/-) is the same as Fix.plus/minus
            if (pegPrice < pegBottom || pegPrice > pegTop || low == 0) {
                markStatus(CollateralStatus.IFFY);
            } else {
                markStatus(CollateralStatus.SOUND);
            }
        } catch (bytes memory errData) {
            // see: docs/solidity-style.md#Catching-Empty-Data
            if (errData.length == 0) revert(); // solhint-disable-line reason-string
            markStatus(CollateralStatus.IFFY);
        }
    }

    /// Can revert, used by other contract functions in order to catch errors
    /// @return low {UoA/tok} The low price estimate
    /// @return high {UoA/tok} The high price estimate
    /// @return pegPrice {target/ref} The actual price observed in the peg
    function tryPrice()
        external
        view
        override
        returns (
            uint192 low,
            uint192 high,
            uint192 pegPrice
        )
    {
        // {UoA/tok} = {UoA/ref} * {ref/tok}
        uint192 p = chainlinkFeed.price(oracleTimeout).mul(
            refPerTok()
        );
        uint192 err = p.mul(oracleError, CEIL);

        high = p + err;
        low = p - err;
        // assert(low <= high); obviously true just by inspection

        pegPrice = targetPerRef(); // {target/ref} DAI/DAI is always 1
    }

    function usdcPrice()
        external
        view
        returns (
            uint192
        )
    {
        // {UoA/ref}
        return usdcFeed.price(oracleTimeout);
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    /// ilk returs the collateral price with safety margin in RAY, i.e. the maximum stablecoin allowed per unit of collateral.
    function refPerTok() public view override returns (uint192) {

        (, , uint256 spot, , ) = Vat(mcdVat).ilks(poolIlk);
        return _safeWrap(uint192(spot).mul(1e18).div(1e27));
    }

    function wrappedDeposit(address usr, uint wad) external returns(bool) {
        erc20.transferFrom(msg.sender, address(this), wad);
        erc20.approve(mcdGemJoin, wad);
        GemJoin(mcdGemJoin).join(address(this), wad);
        wrapperToken.mint(usr, wad);
        
    }

    function wrappedWithdraw(address usr, uint wad) external returns(bool) {

        require(wrapperToken.balanceOf(usr) >= wad, "Insuficient balance");
        GemJoin(mcdGemJoin).exit(address(this), wad);
        erc20.transfer(usr, wad);
        wrapperToken.burnFrom(usr, wad);
        return true;
    }
}
