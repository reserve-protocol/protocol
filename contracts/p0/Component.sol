// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/Context.sol";
import "contracts/p0/interfaces/IMain.sol";

/**
 * Abstract superclass for system contracts registered in Main
 */
abstract contract Component is IComponent, Context {
    IMain internal main;
    address private deployer;

    constructor() {
        deployer = _msgSender();
    }

    function initComponent(IMain main_, ConstructorArgs calldata args) external override {
        require(deployer == _msgSender(), "Component: caller is not the deployer");
        main = main_;
        init(args);
        deployer = address(0); // Prohibit repeated initialization
    }

    modifier notPaused() {
        require(!main.paused(), "Component: system is paused");
        _;
    }

    modifier onlyOwner() {
        require(main.owner() == _msgSender(), "Component: caller is not the owner");
        _;
    }

    // modifier onlyRegistered or onlyComponent or something -- will need to replace onlyMain()

    // solhint-disable-next-line no-empty-blocks
    function init(ConstructorArgs calldata args) internal virtual {}
}
