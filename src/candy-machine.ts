import * as anchor from '@project-serum/anchor';
import { getAssociatedTokenAddress } from '@solana/spl-token' // IGNORE THESE ERRORS IF ANY

import { MintLayout, TOKEN_PROGRAM_ID, Token } from '@solana/spl-token';
import {
    SystemProgram,
    Transaction,
    SYSVAR_SLOT_HASHES_PUBKEY,
} from '@solana/web3.js';
import { sendTransactions, SequenceType } from './connection';

import {
    CIVIC,
    getAtaForMint,
    getNetworkExpire,
    getNetworkToken,
    SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID,
} from './utils';

export const CANDY_MACHINE_PROGRAM = new anchor.web3.PublicKey(
    "cndy3Z4yapfJBmL3ShUp5exZKqR3z33thTzeNMm2gRZ"
);

export interface CandyMachineState {
    itemsAvailable: number;
}

export type SetupState = {
    mint: anchor.web3.Keypair;
    userTokenAccount: anchor.web3.PublicKey;
    transaction: string;
};


export interface CandyMachineAccount {
    id: anchor.web3.PublicKey;
    program: anchor.Program;
    state: CandyMachineState;
}


export interface CandyMachine {
    id: anchor.web3.PublicKey,
    program: anchor.Program;
    state: CandyMachineState;
}

export const TOKEN_METADATA_PROGRAM_ID = new anchor.web3.PublicKey(
    "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

const getMetadata = async (
    mint: anchor.web3.PublicKey
): Promise<anchor.web3.PublicKey> => {
    return (
        await anchor.web3.PublicKey.findProgramAddress(
            [
                Buffer.from("metadata"),
                TOKEN_METADATA_PROGRAM_ID.toBuffer(),
                mint.toBuffer(),
            ],
            TOKEN_METADATA_PROGRAM_ID
        )
    )[0];
};

const getMasterEdition = async (
    mint: anchor.web3.PublicKey
): Promise<anchor.web3.PublicKey> => {
    return (
        await anchor.web3.PublicKey.findProgramAddress(
            [
                Buffer.from("metadata"),
                TOKEN_METADATA_PROGRAM_ID.toBuffer(),
                mint.toBuffer(),
                Buffer.from("edition"),
            ],
            TOKEN_METADATA_PROGRAM_ID
        )
    )[0];
};

export const getCandyMachineState = async (
    anchorWallet: anchor.Wallet,
    candyMachineId: anchor.web3.PublicKey,
    connection: anchor.web3.Connection,
): Promise<CandyMachine> => {
    const provider = new anchor.Provider(connection, anchorWallet, {
        preflightCommitment: 'recent',
    });

    const idl = await anchor.Program.fetchIdl(CANDY_MACHINE_PROGRAM, provider);

    const program = new anchor.Program(idl, CANDY_MACHINE_PROGRAM, provider);

    const state: any = await program.account.candyMachine.fetch(candyMachineId);
    const itemsAvailable = state.data.itemsAvailable.toNumber();

    return {
        id: candyMachineId,
        program,
        state: {
            itemsAvailable
        },
    };
};


type MintResult = {
    mintTxId: string;
    metadataKey: anchor.web3.PublicKey;
};

export const awaitTransactionSignatureConfirmation = async (
    txid: anchor.web3.TransactionSignature,
    timeout: number,
    connection: anchor.web3.Connection,
    queryStatus = false,
): Promise<anchor.web3.SignatureStatus | null | void> => {
    let done = false;
    let status: anchor.web3.SignatureStatus | null | void = {
        slot: 0,
        confirmations: 0,
        err: null,
    };
    let subId = 0;
    status = await new Promise(async (resolve, reject) => {
        setTimeout(() => {
            if (done) {
                return;
            }
            done = true;
            console.log('Rejecting for timeout...');
            reject({ timeout: true });
        }, timeout);

        while (!done && queryStatus) {
            // eslint-disable-next-line no-loop-func
            (async () => {
                try {
                    const signatureStatuses = await connection.getSignatureStatuses([
                        txid,
                    ]);
                    status = signatureStatuses && signatureStatuses.value[0];
                    if (!done) {
                        if (!status) {
                            console.log('REST null result for', txid, status);
                        } else if (status.err) {
                            console.log('REST error for', txid, status);
                            done = true;
                            reject(status.err);
                        } else if (!status.confirmations) {
                            console.log('REST no confirmations for', txid, status);
                        } else {
                            console.log('REST confirmation for', txid, status);
                            done = true;
                            resolve(status);
                        }
                    }
                } catch (e) {
                    if (!done) {
                        console.log('REST connection error: txid', txid, e);
                    }
                }
            })();
            await sleep(2000);
        }
    });

    //@ts-ignore
    if (connection._signatureSubscriptions[subId]) {
        connection.removeSignatureListener(subId);
    }
    done = true;
    console.log('Returning status', status);
    return status;
};


const sleep = (ms: number): Promise<void> => {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

const createAssociatedTokenAccountInstruction = (
    associatedTokenAddress: anchor.web3.PublicKey,
    payer: anchor.web3.PublicKey,
    walletAddress: anchor.web3.PublicKey,
    splTokenMintAddress: anchor.web3.PublicKey,
) => {
    const keys = [
        { pubkey: payer, isSigner: true, isWritable: true },
        { pubkey: associatedTokenAddress, isSigner: false, isWritable: true },
        { pubkey: walletAddress, isSigner: false, isWritable: false },
        { pubkey: splTokenMintAddress, isSigner: false, isWritable: false },
        {
            pubkey: anchor.web3.SystemProgram.programId,
            isSigner: false,
            isWritable: false,
        },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        {
            pubkey: anchor.web3.SYSVAR_RENT_PUBKEY,
            isSigner: false,
            isWritable: false,
        },
    ];
    return new anchor.web3.TransactionInstruction({
        keys,
        programId: SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID,
        data: Buffer.from([]),
    });
};

export const createAccountsForMint = async (
    candyMachine: CandyMachineAccount,
    payer: anchor.web3.PublicKey,
): Promise<SetupState> => {
    const mint = anchor.web3.Keypair.generate();
    const userTokenAccountAddress = (
        await getAtaForMint(mint.publicKey, payer)
    )[0];

    const signers: anchor.web3.Keypair[] = [mint];
    const instructions = [
        anchor.web3.SystemProgram.createAccount({
            fromPubkey: payer,
            newAccountPubkey: mint.publicKey,
            space: MintLayout.span,
            lamports:
                await candyMachine.program.provider.connection.getMinimumBalanceForRentExemption(
                    MintLayout.span,
                ),
            programId: TOKEN_PROGRAM_ID,
        }),
        Token.createInitMintInstruction(
            TOKEN_PROGRAM_ID,
            mint.publicKey,
            0,
            payer,
            payer,
        ),
        createAssociatedTokenAccountInstruction(
            userTokenAccountAddress,
            payer,
            payer,
            mint.publicKey,
        ),
        Token.createMintToInstruction(
            TOKEN_PROGRAM_ID,
            mint.publicKey,
            userTokenAccountAddress,
            payer,
            [],
            1,
        ),
    ];

    return {
        mint: mint,
        userTokenAccount: userTokenAccountAddress,
        transaction: (
            await sendTransactions(
                candyMachine.program.provider.connection,
                candyMachine.program.provider.wallet,
                [instructions],
                [signers],
                SequenceType.StopOnFailure,
                'singleGossip',
                () => { },
                () => false,
                undefined,
                [],
                [],
            )
        ).txs[0].txid,
    };
};

export const mintOneToken = async (
    candyMachine: CandyMachineAccount,
    payer: anchor.web3.PublicKey,
    mint: anchor.web3.Keypair,
    beforeTransactions: Transaction[] = [],
    afterTransactions: Transaction[] = [],
    setupState?: SetupState,
): Promise<MintResult | null> => {
    const userTokenAccountAddress = (
        await getAtaForMint(mint.publicKey, payer)
    )[0];


    const candyMachineAddress = candyMachine.id;

    const instructions = [];
    const signers: anchor.web3.Keypair[] = [];


    const metadataAddress = await getMetadata(mint.publicKey);
    const masterEdition = await getMasterEdition(mint.publicKey);


    const NftTokenAccount = await getAssociatedTokenAddress(
        mint.publicKey,
        payer
    );
    const nftData: any = {
        mintPublicKey: mint.publicKey,
        url: "https://s3.eu-central-1.wasabisys.com/somefiles/0.json",
        name: "John NFT"
    }


    instructions.push(
        await candyMachine.program.instruction.mintNft(nftData, {
            accounts: {
                mintAuthority: payer,
                mint: mint.publicKey,
                tokenAccount: NftTokenAccount,
                tokenProgram: TOKEN_PROGRAM_ID,
                metadata: metadataAddress,
                tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
                payer: payer,
                systemProgram: SystemProgram.programId,
                rent: anchor.web3.SYSVAR_RENT_PUBKEY,
                masterEdition: masterEdition,
            },
        }),
    );





    const instructionsMatrix = [instructions];
    const signersMatrix = [signers];

    try {
        const txns = (
            await sendTransactions(
                candyMachine.program.provider.connection,
                candyMachine.program.provider.wallet,
                instructionsMatrix,
                signersMatrix,
                SequenceType.StopOnFailure,
                'singleGossip',
                () => { },
                () => false,
                undefined,
                beforeTransactions,
                afterTransactions,
            )
        ).txs.map(t => t.txid);
        const mintTxn = txns[0];
        return {
            mintTxId: mintTxn,
            metadataKey: metadataAddress,
        };
    } catch (e) {
        console.log(e);
    }
    return null;
};