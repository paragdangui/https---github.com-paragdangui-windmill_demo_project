
export async function main(message: string, name: string, step_id: string) {
  const flow_id = process.env.WM_ROOT_FLOW_JOB_ID
  console.log("message", message)
  console.log("name",name)
  console.log("step_id", step_id)
  return { message, flow_id, step_id, recover: false }
}
