// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/libraries/Fixed.sol";
import "./ERC20Mock.sol";

contract FTokenMock is ERC20Mock {
    using FixLib for uint192;
    bool internal _paused;
    uint256 public assetsPerShare;

    constructor(
        string memory name,
        string memory symbol
    ) ERC20Mock(name, symbol) {
        _paused = true;
        assetsPerShare = 1 ether;
    }

    function decimals() public pure override returns (uint8) {
        return 18;
    }

    function paused() public view returns (bool) {
        return _paused;
    }

    function pause() external {
        _paused = true;
    }

    function unpause() external {
        _paused = false;
    }

    function toAssetAmount(uint256 _shares, bool _roundUp) external view returns (uint256) {
        uint256 amount = (_shares * assetsPerShare)/(1 ether);
        if (_roundUp){
            amount++;
        }
        return amount;
    }

    function setAssetsPerShare(uint256 _assetsPerShare) external{
        assetsPerShare = _assetsPerShare;
    }
}
