// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../../libraries/Fixed.sol";
import "./ERC20Mock.sol";

contract REarnStEthMock is ERC20Mock {
    using FixLib for uint192;
    address internal _underlyingToken;

    uint256 internal pps = 1000000000000000000;

    constructor(
        string memory name,
        string memory symbol,
        address underlyingToken
    ) ERC20Mock(name, symbol) {
        _underlyingToken = underlyingToken;
    }

    function decimals() public pure override returns (uint8) {
        return 18;
    }

    function pricePerShare() public view returns (uint256) {
        return pps;
    }

    function setPricePerShare(uint256 _pps) public {
        pps = _pps;
    }
}
