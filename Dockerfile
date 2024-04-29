FROM node:18.19.0
# Create app directory.
WORKDIR /usr/src/app

RUN npm install -g npm@10.6.0

# Install app dependencies.
COPY package.json ./
COPY yarn.lock ./
# RUN yarn install


# Bundle app source.
COPY . .

ENV NODE_OPTIONS='--max-old-space-size=12000'
ENV FORK=true
ENV MAINNET_BLOCK=19751052
ENV FORK_BLOCK=19751052
ENV PROTO_IMPL=1
ENV SUBGRAPH_URL='https://subgraph.satsuma-prod.com/327d6f1d3de6/reserve/reserve-mainnet/api'
ENV FORK_NETWORK='mainnet'
ENV ETHERSCAN_API_KEY=5WJCWSB9M3PGZW649I3T42EA9MGK4UGGFV
ENV MAINNET_RPC_URL="https://eth-mainnet.g.alchemy.com/v2/bnlCQsmDp2DTQyJoOWOYEXI5PzoUwaIS"

# Run app.
# CMD ["npx", "hardhat", "proposal-validator", "--proposalid", "19635069547141631801899721667815895344178432860995231621586111571059800714939", "--network", "hardhat", "--show-stack-traces"]
CMD ./run.sh