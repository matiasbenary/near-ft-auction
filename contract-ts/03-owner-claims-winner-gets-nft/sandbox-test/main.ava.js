import anyTest from 'ava';
import { NEAR, Worker } from 'near-workspaces';
import { setDefaultResultOrder } from 'dns'; setDefaultResultOrder('ipv4first'); // temp fix for node >v17

/**
 *  @typedef {import('near-workspaces').NearAccount} NearAccount
 *  @type {import('ava').TestFn<{worker: Worker, accounts: Record<string, NearAccount>}>}
 */
const test = anyTest;
const NFT_WASM_FILEPATH = "./sandbox-test/non_fungible_token.wasm";
test.beforeEach(async (t) => {
  // Init the worker and start a Sandbox server
  const worker = t.context.worker = await Worker.init();

  // Create accounts
  const root = worker.rootAccount;

  const alice = await root.createSubAccount("alice", { initialBalance: NEAR.parse("50 N").toString() });
  const bob = await root.createSubAccount("bob", { initialBalance: NEAR.parse("50 N").toString() });
  const contract = await root.createSubAccount("contract", { initialBalance: NEAR.parse("50 N").toString() });
  const nft_contract = await root.createSubAccount("nft_contract");
  const auctioneer = await root.createSubAccount("auctioneer", { initialBalance: NEAR.parse("50 N").toString() });

  // Deploy contract nft 
  await nft_contract.deploy(NFT_WASM_FILEPATH);
  await nft_contract.call(nft_contract, "new_default_meta", { "owner_id": nft_contract.accountId });

  const token_id = "1";
  // Mint NFT
  let request_payload = {
    "token_id": token_id,
    "receiver_id": contract.accountId,
    "metadata": {
      "title": "LEEROYYYMMMJENKINSSS",
      "description": "Alright time's up, let's do this.",
      "media": "https://external-content.duckduckgo.com/iu/?u=https%3A%2F%2Ftse3.mm.bing.net%2Fth%3Fid%3DOIP.Fhp4lHufCdTzTeGCAblOdgHaF7%26pid%3DApi&f=1"
    },
  };

  await nft_contract.call(nft_contract, "nft_mint", request_payload, { attachedDeposit: NEAR.from("8000000000000000000000").toString(), gas: "300000000000000" });

  // Deploy contract (input from package.json)
  await contract.deploy(process.argv[2]);

  // Initialize contract, finishes in 1 minute
  await contract.call(contract, "init", {
    end_time: String((Date.now() + 60000) * 10 ** 6),
    auctioneer: auctioneer.accountId,
    nft_contract: nft_contract.accountId,
    token_id: token_id
  });

  // Save state for test runs, it is unique for each test
  t.context.worker = worker;
  t.context.accounts = { alice, bob, contract, auctioneer, nft_contract };
});

test.afterEach.always(async (t) => {
  // Stop Sandbox server
  await t.context.worker.tearDown().catch((error) => {
    console.log('Failed to stop the Sandbox:', error);
  });
});

test("Bids are placed", async (t) => {
  const { alice, contract } = t.context.accounts;

  await alice.call(contract, "bid", {}, { attachedDeposit: NEAR.parse("1 N").toString() });

  const highest_bid = await contract.view("get_highest_bid", {});

  t.is(highest_bid.bidder, alice.accountId);
  t.is(highest_bid.bid, NEAR.parse("1 N").toString());
});

test("Outbid returns previous bid", async (t) => {
  const { alice, bob, contract } = t.context.accounts;

  await alice.call(contract, "bid", {}, { attachedDeposit: NEAR.parse("1 N").toString() });
  const aliceBalance = await alice.balance();

  await bob.call(contract, "bid", {}, { attachedDeposit: NEAR.parse("2 N").toString() });
  const highest_bid = await contract.view("get_highest_bid", {});
  t.is(highest_bid.bidder, bob.accountId);
  t.is(highest_bid.bid, NEAR.parse("2 N").toString());

  // we returned the money to alice
  const aliceNewBalance = await alice.balance();
  t.deepEqual(aliceNewBalance.available, aliceBalance.available.add(NEAR.parse("1 N")));
});

test("Auction closes", async (t) => {
  const { alice, contract } = t.context.accounts;

  // alice can bid
  await alice.call(contract, "bid", {}, { attachedDeposit: NEAR.parse("1 N").toString() });

  // fast forward approx a minute
  await t.context.worker.provider.fastForward(60)

  // alice cannot bid anymore
  await t.throwsAsync(alice.call(contract, "bid", {}, { attachedDeposit: NEAR.parse("1 N").toString() }))
});


test("Claim auction", async (t) => {
  const { alice, bob, contract, auctioneer,nft_contract} = t.context.accounts;

  await alice.call(contract, "bid", {}, { attachedDeposit: NEAR.parse("1 N").toString(), gas: "300000000000000" });
  await bob.call(contract, "bid", {}, { attachedDeposit: NEAR.parse("2 N").toString(), gas: "300000000000000" });

  const auctioneerBalance = await auctioneer.balance();
  const available = parseFloat(auctioneerBalance.available.toHuman());


  // fast forward approx a minute
  await t.context.worker.provider.fastForward(60)

  await auctioneer.call(contract, "claim", {}, { gas: "300000000000000" });

  const contractNewBalance = await auctioneer.balance();
  const new_available = parseFloat(contractNewBalance.available.toHuman());

  t.is(new_available.toFixed(2), (available + 2).toFixed(2));

  const response = await nft_contract.call(nft_contract, "nft_token",{"token_id": "1"},{ gas: "300000000000000" });
  t.is(response.owner_id,bob.accountId);
});

test("Auction open", async (t) => {
  const { alice, bob, contract, auctioneer } = t.context.accounts;

  await alice.call(contract, "bid", {}, { attachedDeposit: NEAR.parse("1 N").toString() });
  await bob.call(contract, "bid", {}, { attachedDeposit: NEAR.parse("2 N").toString() });

  await t.throwsAsync(auctioneer.call(contract, "claim", {}, { gas: "300000000000000" }))
});

test("Auction has been claimed", async (t) => {
  const { alice, bob, contract, auctioneer } = t.context.accounts;

  await alice.call(contract, "bid", {}, { attachedDeposit: NEAR.parse("1 N").toString(), gas: "300000000000000" });
  await bob.call(contract, "bid", {}, { attachedDeposit: NEAR.parse("2 N").toString(), gas: "300000000000000" });

  // fast forward approx a minute
  await t.context.worker.provider.fastForward(60)

  await auctioneer.call(contract, "claim", {}, { gas: "300000000000000" });

  await t.throwsAsync(auctioneer.call(contract, "claim", {}, { gas: "300000000000000" }))
});