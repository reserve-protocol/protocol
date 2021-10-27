// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "../../../mocks/ERC20Mock.sol";
import "../../libraries/Token.sol";

/// @dev A contract that will receive a token, and allows for it to be retrieved.
contract MockHolder {
    constructor(address tokenAddr, address retriever) {
        ERC20Mock(tokenAddr).approve(retriever, type(uint256).max);
    }
}

/// @dev Invariant testing for Token library
contract TokenLibEchidnaTest {
    using Token for Token.Info;

    ERC20Mock internal _token;
    Token.Info internal innerTokenInfo;
    address internal holder;

    /// @dev Instantiate the contract, and a holder address that will return token when asked to.
    constructor() {
        _token = new ERC20Mock("Token", "TKN");
        innerTokenInfo.tokenAddress = address(_token);
        holder = address(new MockHolder(address(_token), address(this)));
    }

    /// @dev Test that supply and balances hold on safeTransfer.
    function safeTransfer(uint256 mintAmount, uint256 transferAmount) public {
        _token.mint(address(this), mintAmount);
        uint256 thisBalance = innerTokenInfo.myBalance();
        uint256 holderBalance = innerTokenInfo.getBalance(holder);
        innerTokenInfo.safeTransfer(holder, transferAmount);
        assert(innerTokenInfo.myBalance() == (thisBalance - transferAmount));
        assert(innerTokenInfo.getBalance(holder) == (holderBalance + transferAmount));
        assert(innerTokenInfo.myBalance() + innerTokenInfo.getBalance(holder) <= _token.totalSupply());
    }

    /// @dev Test that supply and balances hold on transferFrom.
    function transferFrom(uint256 mintAmount, uint256 transferAmount) public {
        _token.mint(address(this), mintAmount);
        uint256 thisBalance = innerTokenInfo.myBalance();
        uint256 holderBalance = innerTokenInfo.getBalance(holder);
        innerTokenInfo.safeTransferFrom(holder, address(this), transferAmount);
        assert(innerTokenInfo.myBalance() == (thisBalance + transferAmount));
        assert(innerTokenInfo.getBalance(holder) == (holderBalance - transferAmount));
        assert(innerTokenInfo.myBalance() + innerTokenInfo.getBalance(holder) <= _token.totalSupply());
    }

    /// @dev Property that checks that balances should never exceed totalSupply
    function crytic_less_than_total_supply() public returns (bool) {
        return innerTokenInfo.myBalance() + innerTokenInfo.getBalance(holder) <= _token.totalSupply();
    }

    function crytic_token_has_correct_value() public returns (bool) {
        return innerTokenInfo.tokenAddress == address(_token);
    }
}
