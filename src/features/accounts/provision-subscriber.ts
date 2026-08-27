type ProvisionSubscriberInput = {
  accountName: string;
  email: string;
};

type ProvisionSubscriberDependencies = {
  inviteUser: (email: string) => Promise<string>;
  createAccount: (input: ProvisionSubscriberInput & { userId: string }) => Promise<void>;
  removeUser: (userId: string) => Promise<unknown>;
};

export async function provisionSubscriber(
  input: ProvisionSubscriberInput,
  dependencies: ProvisionSubscriberDependencies,
) {
  const userId = await dependencies.inviteUser(input.email);

  try {
    await dependencies.createAccount({ ...input, userId });
  } catch (error) {
    await dependencies.removeUser(userId);
    throw error;
  }
}

