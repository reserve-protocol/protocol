// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../Ownable.sol"; // temporary
// import "@openzeppelin/contracts/access/Ownable.sol";

import "../libraries/CommonErrors.sol";
import "./interfaces/ICollateral.sol";

contract Oracle is Ownable {
    mapping(address => uint256) prices;

    function setPrice(address token, uint256 amount) public onlyOwner {
        prices[token] = amount;
    }

    function getPrice(address token) public view returns (uint256) {
        if (prices[token] == 0) {
            revert CommonErrors.PriceNotFound();
        }
        return prices[token];
    }
}
