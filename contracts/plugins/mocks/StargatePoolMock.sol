// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { FIX_ONE, FixLib} from "contracts/libraries/Fixed.sol";
import { ERC20Mock } from "./ERC20Mock.sol";

contract StargatePoolMock is ERC20Mock {
    using FixLib for uint192;
    uint256 internal _totalLiquidity;
    uint256 internal _totalSupply;
    uint8 _decimals;
    bool internal _stopSwap;

    constructor(string memory name, string memory symbol, uint8 decimals_) ERC20Mock(name, symbol) {
        _totalLiquidity = FIX_ONE + FIX_ONE ;
        _totalSupply = FIX_ONE;
        _decimals = decimals_;
        _stopSwap = false;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    // function convertToShares(uint256 assets_) external view returns (uint256) {
    //     return FIX_ONE.div(_refPerTok).mulu_toUint(assets_);
    // }

    // function convertToAssets(uint256 shares_) external view returns (uint256) {
    //     return _refPerTok.mulu_toUint(shares_);
    // }
    function setLiquidity(uint256 totalLiquidity) external{
        _totalLiquidity = totalLiquidity;
    }
    function setSupply(uint256 totalSupply) external{
        _totalLiquidity = totalSupply;
    }
    function setStopSWap(bool stopSwap_) external{ 
        _stopSwap = stopSwap_;
    }
    function stopSwap() external view returns (bool){
        return _stopSwap;
    }
}