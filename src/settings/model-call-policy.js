// The simulation uses saved configuration and preserves each call's space name
// as it was at the time of the attempt. No external service is contacted.
export function hasUnsavedModelConfig(draft,saved,{credentialPending=false,testPending=false}={}){
  const configuration=value=>({
    name:value?.name||'',capability:value?.capability||'',protocol:value?.protocol||'',
    url:value?.url||'',modelId:value?.modelId||'',spaces:[...(value?.spaces||[])].sort()
  });
  return credentialPending||testPending||JSON.stringify(configuration(draft))!==JSON.stringify(configuration(saved));
}

export function checkModelCall({service,spaceId,spaces,hasUnsavedChanges=false,testing=false}){
  const space=spaces.find(item=>item.id===spaceId&&item.status!=='archived');
  const context={spaceId,space:space?.name||spaceId||'未选择空间'};
  if(testing)return {...context,allowed:false,code:'testing',reason:'连接正在测试，请等待测试完成并保存配置。'};
  if(hasUnsavedChanges)return {...context,allowed:false,code:'unsaved',reason:'配置或测试结果尚未保存，请先在连接配置中保存。'};
  if(!space)return {...context,allowed:false,code:'space-unavailable',reason:'所选空间不存在或已归档。'};
  if(service?.status!=='passed')return {...context,allowed:false,code:'unverified',reason:'已保存的服务配置尚未通过模拟测试。'};
  if(!service.spaces?.includes(spaceId))return {...context,allowed:false,code:'unauthorized',reason:'所选空间未获此模型服务的调用授权。'};
  return {...context,allowed:true,code:'allowed',reason:'已保存的服务配置与空间授权校验通过。'};
}

export function modelCallRecord({id,at,service,access}){
  return {id,at,serviceId:service.id,model:service.modelId,spaceId:access.spaceId,space:access.space,
    result:access.allowed?'模拟成功':'模拟拒绝',reason:access.reason};
}
