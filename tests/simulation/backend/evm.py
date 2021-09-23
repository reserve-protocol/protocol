from interface import AbstractProtocol, Account, Token
from typing import Dict, List


# TODO
class EconProtocol(AbstractProtocol):

    # basket: Basket
    # rtoken: ERC20

    def __init__(self, tokens: List[Token]):
        pass

    def issue(self, msg_sender: Account, amount: int):
        pass

    def redeem(self, msg_sender: Account, amount: int):
        pass
