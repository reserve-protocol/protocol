// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../Ownable.sol"; // temporary
// import "@openzeppelin/contracts/access/Ownable.sol";

import "../libraries/CommonErrors.sol";
import "./interfaces/ICollateral.sol";

contract Oracle is Ownable {
    // Mapping Token -> TWAP Period -> Amount
    mapping(address => mapping(uint256 => uint256)) private _prices;

    function setPrice(
        address token,
        uint256 period,
        uint256 amount
    ) public onlyOwner {
        _prices[token][period] = amount;
    }

    function getPrice(address token, uint256 period) public view returns (uint256) {
        if (_prices[token][period] == 0) {
            revert CommonErrors.PriceNotFound();
        }
        return _prices[token][period];
    }
}
