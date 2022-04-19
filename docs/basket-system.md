# Basket System

There are 3 types of baskets in our system:
(i) Prime Basket
(ii) Reference Basket
(iii) Collateral Basket

`BU` = basket unit

## Prime Basket

`{target/BU}`

The prime basket is the most fundamental of the three baskets. It is a definition of a `BU` in terms of `target` units, such as USD or EURO. The prime basket consists of a set of triples `<collateral token, target unit, target amount>`, such as `<cUSDC, USD, 0.33 cents>`.

The prime basket is indefinitely static. The only way it can change is via governance action.

## Reference Basket

`{ref/BU}`

The reference basket is the second most fundamental of the baskets. It is calculated from the prime basket whenever a token defaults, or governance triggers a switch manually. The reference basket should be worth the same number of `target` units as the prime basket. It consists of a set of triples `<collateral token, reference unit, reference amount>`, such as `<cUSDC, USDC, 0.33>`.

## Collateral Basket

`{tok/BU}`

The collateral basket is the most dynamic of the baskets. You can think of it like a view of the reference basket given particular defi redemption rates. If a collateral token appreciates, the quantity of that token in the collateral basket is decreased in order to keep the total number of reference amounts in the basket constant. It consists of a set of pairs `<collateral token, token quantity>`, such as `<cUSDC, O.29>`.

This is the form of the basket that issuers and redeemer will care most about. Issuance and redemption quantities are given by the collateral basket times the `rTok/BU` exchange rate.

Since defi redemption rates can change every block, so can the collateral basket. As an issuance is pending in the mempool, the quantities of tokens that will be ingested when the tx is mined decreases slightly as the collateral becomes worth more. If furnace melting happens in that time, however, this can increase the quantity of collateral tokens in the basket and cause the issuance to fail.

And the flip side: as a redemption is pending in the mempool the quantities of collateral tokens the redeemer will receive steadily decreases. If a furnace melting happens in that time the quantities will be increased, causing the redeemer to get more than they expected.
