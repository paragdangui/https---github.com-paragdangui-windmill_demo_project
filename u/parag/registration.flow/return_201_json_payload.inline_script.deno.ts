export async function main(user){
  return {
    windmill_status_code: 201,
    result: { success: true, user }
  };
}