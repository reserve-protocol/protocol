// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/Context.sol";
// import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/p0/interfaces/IMain.sol";

/**
 * Abstract superclass for system contracts registered in Main
 */
abstract contract Component is Context {
    IMain internal main;
    address private deployer;

    constructor() {
        deployer = _msgSender();
    }

    function initComponent(IMain main_, ConstructorArgs calldata args) external {
        require(deployer == _msgSender(), "Component: caller is not the deployer");
        main = main_;
        init(args);
        deployer = address(0); // Prohibit repeated initialization
    }

    modifier notPaused() {
        require(!main.paused());
        _;
    }

    modifier onlyOwner() {
        require(main.owner() == _msgSender(), "Component: caller is not the owner");
        _;
    }

    // modifier onlyRegistered or onlyComponent or something -- will need to replace onlyMain()

    // Must be implemented by deriving contract
    // TODO -- is args here _actually_ calldata, since the function's internal?
    function init(ConstructorArgs calldata args) internal virtual;
}
