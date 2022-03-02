// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/Context.sol";
import "contracts/interfaces/IMain.sol";

/**
 * Abstract superclass for system contracts registered in Main
 */
abstract contract Component is IComponent, Context {
    IMain internal main;
    bool private initialized;

    function initComponent(IMain main_, ConstructorArgs calldata args) external {
        require(!initialized, "Component: already initialized");
        main = main_;
        init(args);
        initialized = true; // Prohibit repeated initialization
    }

    modifier notPaused() {
        require(!main.paused(), "Component: system is paused");
        _;
    }

    modifier onlyOwner() {
        require(main.owner() == _msgSender(), "Component: caller is not the owner");
        _;
    }

    // solhint-disable-next-line no-empty-blocks
    function init(ConstructorArgs calldata args) internal virtual {}
}
