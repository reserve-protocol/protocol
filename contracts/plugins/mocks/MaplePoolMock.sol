// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { FIX_ONE, FixLib} from "contracts/libraries/Fixed.sol";
import { ERC20Mock } from "./ERC20Mock.sol";

contract MaplePoolMock is ERC20Mock {
    using FixLib for uint192;
    address internal _underlyingToken;

    uint192 internal _refPerTok;

    constructor(string memory name, string memory symbol) ERC20Mock(name, symbol) {
        _refPerTok = FIX_ONE;
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function convertToShares(uint256 assets_) external view returns (uint256) {
        return FIX_ONE.div(_refPerTok).mulu_toUint(assets_);
    }

    function convertToAssets(uint256 shares_) external view returns (uint256) {
        return _refPerTok.mulu_toUint(shares_);
    }

    /// @param rate {ref/tok}
    function setRefPerTok(uint192 rate) external {
        _refPerTok = rate;
    }
}
