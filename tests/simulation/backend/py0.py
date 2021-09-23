from dataclasses import dataclass
from interface import AbstractProtocol, AbstractERC20, Account, Token
from typing import Dict, List


class ERC20(AbstractERC20):
    """Python ERC20 implementation that adheres to the simulation interface requirements."""

    def __init__(self):
        self.balances: Dict[Account, int] = {}

    def balanceOf(self, account: Account) -> int:
        return self.balances.get(account, 0)

    def mint(self, account: Account, amount: int) -> None:
        self.balances[account] = self.balances.get(account, 0) + amount

    def burn(self, account: Account, amount: int) -> None:
        self.balances[account] = self.balances.get(account, 0) - amount
        assert self.balances[account] >= 0, "cannot burn more than balance"

    def transfer(self, sender: Account, recipient: Account, amount: int) -> None:
        self.balances[sender] = self.balances.get(sender, 0) - amount
        assert self.balances[sender] >= 0, "cannot transfer more than balance"
        self.balances[recipient] = self.balances.get(recipient, 0) + amount


@dataclass
class Basket:
    tokens: Dict[Token, ERC20]
    scalar_multiplier: float

    def adjusted_quantity(self, token: Token) -> int:
        assert token in self.tokens, "invalid token"
        return token.quantity * self.scalar_multiplier


class EconProtocol(AbstractProtocol):
    """Python protocol implementation that adheres to the simulation interface requirements."""

    _basket: Basket
    _rtoken: ERC20

    def __init__(self, tokens: List[Token]):
        self._basket = Basket({tokens[i]: ERC20() for i in range(len(tokens))}, 1.0)
        self._rtoken = ERC20()

    @property
    def basket_tokens(self) -> List[ERC20]:
        return [v for _, v in self._basket.tokens.items()]

    @property
    def rtoken(self) -> ERC20:
        return self._rtoken

    def issue(self, msg_sender: Account, amount: int):
        for token, erc20 in self._basket.tokens.items():
            amt = int(amount * self._basket.adjusted_quantity(token) / 10 ** 18)
            erc20.transfer(msg_sender, Account.RToken, amt)
        self._rtoken.mint(msg_sender, amount)

    def redeem(self, msg_sender: Account, amount: int):
        self._rtoken.burn(msg_sender, amount)
        for token, erc20 in self._basket.tokens.items():
            amt = int(amount * self._basket.adjusted_quantity(token) / 10 ** 18)
            erc20.transfer(Account.RToken, msg_sender, amt)
