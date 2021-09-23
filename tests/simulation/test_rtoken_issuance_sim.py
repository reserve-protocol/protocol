import pytest
from simulation.interface import Account, Token

basket = [
    Token("USDC", 333334),
    Token("PAX", 333333 * 10 ** 12),
    Token("TUSD", 333333 * 10 ** 12),
]


@pytest.fixture
def backends(Backends):
    """Deploys 3 ERC20 tokens on all backends."""
    backends = [Backend(basket) for Backend in Backends]

    # Mint enough for 100 RTokens
    for i in range(len(backends)):
        backends[i].basket_tokens[0].mint(Account.Alice, 333334 * 10 ** 2)
        backends[i].basket_tokens[1].mint(Account.Alice, 333333 * 10 ** 14)
        backends[i].basket_tokens[2].mint(Account.Alice, 333333 * 10 ** 14)
    return backends


def test_issuance_redemption(backends):
    """Tests that issuance works as expected for all supplied backends."""
    for b in backends:
        assert b.rtoken.balanceOf(Account.Alice) == 0, "alice should have 0 rtoken"

        b.issue(Account.Alice, 100 * 10 ** 18)
        assert b.rtoken.balanceOf(Account.Alice) == 100 * 10 ** 18, "alice should have 100 rtoken"

        # ERC20 balances should be zero
        for erc20 in b.basket_tokens:
            assert erc20.balanceOf(Account.Alice) == 0, "balance not zero"

        b.redeem(Account.Alice, 100 * 10 ** 18)
        assert b.rtoken.balanceOf(Account.Alice) == 0, "alice should have 0 rtoken"

        # ERC20 balances should be back to normal
        for i, erc20 in enumerate(b.basket_tokens):
            assert (
                erc20.balanceOf(Account.Alice) == basket[i].quantity * 100
            ), "balance should be restored"

    # TODO: Compare state directly?
