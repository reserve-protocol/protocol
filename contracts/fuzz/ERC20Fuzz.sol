// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import "contracts/plugins/mocks/ERC20Mock.sol";
import "contracts/fuzz/IFuzz.sol";

// An ERC20Fuzz is an ERC20Mock that knows about main, and performs the _msgSender override that our
// components also do.
contract ERC20Fuzz is ERC20Mock {
    IMainFuzz internal main;

    // solhint-disable-next-line no-empty-blocks
    constructor(
        string memory name,
        string memory symbol,
        IMainFuzz _main
    ) ERC20Mock(name, symbol) {
        main = _main;
    }

    function _msgSender() internal view virtual override returns (address) {
        return main.translateAddr(msg.sender);
    }
}
