// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../Ownable.sol"; // temporary
// import "@openzeppelin/contracts/access/Ownable.sol";

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./interfaces/IRToken.sol";

contract RTokenP0 is IRToken, ERC20, Ownable {
    address public manager;

    constructor(
        string memory name_,
        string memory symbol_,
        address owner_,
        address manager_
    ) ERC20(name_, symbol_) {
        _transferOwnership(owner_);
        manager = manager_;
    }

    modifier onlyManager {
        require(_msgSender() == manager, "only manager");
        _;
    }

    function mint(address recipient, uint256 amount) external override onlyManager returns (bool) {
        _mint(recipient, amount);
        return true;
    }

    function burn(address recipient, uint256 amount) external override onlyManager returns (bool) {
        _burn(recipient, amount);
        return true;
    }

    function setManager(address manager_) external onlyOwner {
        manager = manager_;
    }

    function decimals() public view override(IRToken, ERC20) returns (uint8) {
        return 18;
    }
}
