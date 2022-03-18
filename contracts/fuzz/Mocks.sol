// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/p0/Main.sol";
import "contracts/plugins/mocks/ERC20Mock.sol";

// todo: arrange more sensibly. Probably, this file should just hold some core mocks with virtual
// functions, to be overridden as needed in specific test cases
contract MainForFurnace is MainP0 {
    function init(ConstructorArgs calldata) public virtual override(MainP0) {
        require(!initialized, "Already Initialized");
        initialized = true;
        emit Initialized();
    }
}

contract RTokenMock is ERC20Mock {
    uint256 totalMelted = 0;

    // solhint-disable-next-line no-empty-blocks
    constructor() ERC20Mock("RToken Mock", "RTM") {}

    event Melt(address who, uint256 amount);

    function melt(uint256 amount) external {
        emit Melt(_msgSender(), amount);
        _burn(_msgSender(), amount);
        totalMelted += amount;
    }
}
