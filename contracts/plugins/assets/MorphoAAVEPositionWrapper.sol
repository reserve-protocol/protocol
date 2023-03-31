// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/interfaces/IERC20Metadata.sol";
import "../../libraries/Fixed.sol";
import "./IMorpho.sol";

struct MorphoAAVEWrapperConfig {
    IMorpho morpho_controller;
    UsersLens morpho_lens;
    IERC20Metadata underlying_erc20;
    address pool_token;
    string underlying_symbol;
}

contract MorphoAAVEPositionWrapper is ERC20, ERC20Burnable {
    using FixLib for uint192;

    uint8 private immutable _decimals;
    IERC20Metadata private immutable underlying_erc20;

    address pool_token;
    IMorpho morpho_controller;
    UsersLens morpho_lens;

    uint256 tokens_supplied;
    //Amount of the underlying that can be exchanged for 1 of this ERC20
    uint192 private exchange_rate;

    constructor(MorphoAAVEWrapperConfig memory config) ERC20(
        string.concat("RMorphoAAVE", config.underlying_symbol), 
        string.concat("rma", config.underlying_symbol)
    ) {
        underlying_erc20 = config.underlying_erc20;

        _decimals = underlying_erc20.decimals();
        morpho_controller = config.morpho_controller;
        morpho_lens = config.morpho_lens;
        pool_token = config.pool_token;
        exchange_rate = FIX_ONE;
    }

    function underlying_to_fix(uint256 x) internal view returns (uint192) {
        //TODO
        return shiftl_toFix(x, 18 - int8(_decimals));
    }
    
    function fix_to_underlying(uint192 x) internal view returns (uint256) {
        //TODO
        return x.shiftl_toUint(int8(_decimals));
    }

    function adjust_exchange_rate() internal {
        (, , uint256 grown_balance) = morpho_lens.getCurrentSupplyBalanceInOf(pool_token, address(this));
        exchange_rate = exchange_rate.mul(
            underlying_to_fix(grown_balance).div(underlying_to_fix(tokens_supplied))
        );
        tokens_supplied = grown_balance;
    }

    function refresh_exchange_rate() external {
        adjust_exchange_rate();
    }

    function get_exchange_rate() external view returns (uint192) {
        return exchange_rate;
    }

    function mint(address to, uint256 amount) public {
        adjust_exchange_rate();

        underlying_erc20.transferFrom(msg.sender, address(this), amount);
        morpho_controller.supply(pool_token, amount);
        tokens_supplied += amount;

        _mint(to, fix_to_underlying(underlying_to_fix(amount).div(exchange_rate)));
    }

    function burn(uint256 amount) public override {
        adjust_exchange_rate();

        _burn(_msgSender(), amount);

        morpho_controller.withdraw(pool_token, amount);
        tokens_supplied -= amount;

        underlying_erc20.transferFrom(
            address(this), msg.sender,
            fix_to_underlying(underlying_to_fix(amount).mul(exchange_rate))
        );
    }
}
