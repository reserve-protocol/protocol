// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/interfaces/IERC20Metadata.sol";
import "../../../libraries/Fixed.sol";
import "./IMorpho.sol";

struct MorphoAAVEWrapperConfig {
    IMorpho morpho_controller;
    UsersLens morpho_lens;
    IERC20Metadata underlying_erc20;
    address pool_token;
    string underlying_symbol;
}

/**
 * @title MorphoAAVEPositionWrapper
 * @notice ERC20 that wraps a Morpho AAVE position, requiring underlying tokens on mint and redeeming underlying tokens on burn.
 * Designed to mimic a Compound cToken.
 */
contract MorphoAAVEPositionWrapper is ERC20, ERC20Burnable {
    using SafeERC20 for IERC20Metadata;
    using FixLib for uint192;

    uint8 private immutable _decimals;
    IERC20Metadata private immutable underlying_erc20;

    address pool_token;
    IMorpho morpho_controller;
    UsersLens morpho_lens;

    uint256 tokens_supplied;
    //Amount of the underlying that can be exchanged for 1 of this ERC20
    uint192 private exchange_rate;

    /// @param config Configuration of this wrapper. config.pool_token must be the respective AAVE pool token (e.g. aUSDC)
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

    // Takes an uint256 amount of the wrapper token represented by this contract and returns
    // a fixed point representation of that value.
    function wrapper_to_fix(uint256 x) internal pure returns (uint192) {
        return shiftl_toFix(x, -18);
    }

    // Takes an uint256 amount of the underlying token to be deposited into Morpho and returns
    // a fixed point representation of that value.
    function underlying_to_fix(uint256 x) internal view returns (uint192) {
        return shiftl_toFix(x, -int8(_decimals));
    }

    // Takes a fixed point representation of the underlying token to be
    // deposited into Morpho and returns its uint256 amount.
    function fix_to_underlying(uint192 x) internal view returns (uint256) {
        return x.shiftl_toUint(int8(_decimals));
    }

    /* Check the current morpho pool's balance, and update the exchange_rate accordingly, 
     * taking into account the number of tokens expected to be in the pool.
     * This is called on mint and burn, and can be called manually to update the exchange rate.
     */
    function adjust_exchange_rate() internal {
        if (tokens_supplied == 0) {
            return;
        }
        (, , uint256 grown_balance) = morpho_lens.getCurrentSupplyBalanceInOf(pool_token, address(this));
        exchange_rate = exchange_rate.mul(
            underlying_to_fix(grown_balance).div(underlying_to_fix(tokens_supplied))
        );
        tokens_supplied = grown_balance;
    }

    function refresh_exchange_rate() external {
        adjust_exchange_rate();
    }

    function get_exchange_rate() external virtual view returns (uint192) {
        return exchange_rate;
    }

    /* On mint, we transfer the underlying tokens from the user to this contract, 
     * and then supply them to the morpho pool. We then mint an appropriate amount of this ERC20.
     */
    function mint(address to, uint256 amount) public {
        adjust_exchange_rate();

        uint256 to_transfer_of_underlying = fix_to_underlying(wrapper_to_fix(amount).mul(exchange_rate));
         
        underlying_erc20.safeTransferFrom(msg.sender, address(this), to_transfer_of_underlying);
        underlying_erc20.safeIncreaseAllowance(address(morpho_controller), to_transfer_of_underlying);
        morpho_controller.supply(pool_token, to_transfer_of_underlying);
        tokens_supplied += to_transfer_of_underlying;

        _mint(to, amount);
    }

    /* On burn, we transfer the underlying tokens from the morpho pool to this contract, 
     * and then transfer them to the user. We then burn an appropriate amount of this ERC20.
     */
    function burn(uint256 amount) public override {
        adjust_exchange_rate();

        _burn(_msgSender(), amount);

        uint256 to_transfer_of_underlying = fix_to_underlying(wrapper_to_fix(amount).mul(exchange_rate));
        morpho_controller.withdraw(pool_token, to_transfer_of_underlying);
        tokens_supplied -= to_transfer_of_underlying;

        underlying_erc20.transferFrom(address(this), msg.sender, to_transfer_of_underlying);
    }
}
