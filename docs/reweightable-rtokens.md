# Reweightable RTokens

The protocol includes a flag to enable reweightable baskets for RTokens. This flag can only be set at the time of deployment and enables certain additional capabilities for the RToken while disabling others.

In simple terms, a reweightable RToken can change the target units. For example, if an RToken is configured as 1 ETH + 1 BTC in the basket, only the reweightable RTokens can change it to something like 1 ETH + 1 BTC + 100 USD.

In most cases, a non-reweightable RToken will suffice, we expect that to be 99% of all RTokens that exist. However, there are specific cases where you'd want to have reweightable RTokens such as ETFs.

## Basket Normalization

In reweightable RTokens, it's not a guarantee that during a basket change the USD value of the basket remains continuous at the time of the switch. You can easily see this property when, say, a basket switches from being 1 ETH to 1 ETH + 100 USD. The USD value of the basket will increase in this case, but the protocol doesn't have the extra funds (unless it seizes from the stRSR staking pool).

To enable this functionality and to allow governance to make sure that the set baskets can keep the same price at the time of the switch, a spell `SpellBasketNormalizer` is provided in the spells directory. This spell can be used to set the basket in such a way that the USD value of the basket remains the same at the time of the switch.

In order to use the spell, you must create a governance proposal granting the spell contract the `OWNER` role on the RToken then calling the `setNormalizedBasket` basket on the spell contract with appropriate parameters. See the `BasketNormalization` scenario test in the `test` directory for an example of how to use the spell.
