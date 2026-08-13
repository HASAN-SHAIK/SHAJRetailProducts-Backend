jest.mock('bcryptjs', () => ({ hash: jest.fn(async () => 'hashed-password') }));
const { createUser, updateUserRole, updateUserAccess } = require('../src/controllers/tenant/userController');

const res = () => { const r={}; r.status=jest.fn(()=>r); r.json=jest.fn((x)=>x); return r; };

describe('tenant user controls', () => {
  test('creates a branch-scoped staff login with a hashed password', async () => {
    const query=jest.fn().mockResolvedValueOnce({rowCount:1,rows:[{id:'b1'}]}).mockResolvedValueOnce({rowCount:0,rows:[]}).mockResolvedValueOnce({rowCount:1,rows:[{id:2,role:'staff'}]});
    const req={tenantPool:{query},body:{name:'Cashier',email:'cashier@example.com',password:'password123',role:'staff',branch_id:'b1',all_branch_access:false},user:{user_id:1,role:'admin'}};
    const response=res(); await createUser(req,response);
    expect(response.status).toHaveBeenCalledWith(200);
    expect(query.mock.calls[2][1][2]).toBe('hashed-password');
    expect(query.mock.calls[2][1][4]).toBe('b1');
  });

  test('blocks self demotion', async () => {
    const req={tenantPool:{query:jest.fn()},body:{role:'staff'},params:{id:'7'},user:{user_id:7,role:'admin'}};
    const response=res(); await updateUserRole(req,response);
    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json.mock.calls[0][0].code).toBe('SELF_DEMOTION_BLOCKED');
  });

  test('blocks demotion of the last admin', async () => {
    const query=jest.fn().mockResolvedValueOnce({rowCount:1,rows:[{id:2,role:'admin'}]}).mockResolvedValueOnce({rowCount:1,rows:[{count:1}]});
    const req={tenantPool:{query},body:{role:'staff'},params:{id:'2'},user:{user_id:1,role:'admin'}};
    const response=res(); await updateUserRole(req,response);
    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json.mock.calls[0][0].code).toBe('LAST_ADMIN_REQUIRED');
  });

  test('requires a branch for restricted staff access', async () => {
    const query=jest.fn().mockResolvedValueOnce({rowCount:1,rows:[{id:2,role:'staff'}]});
    const req={tenantPool:{query},body:{all_branch_access:false,branch_id:null},params:{id:'2'},user:{user_id:1,role:'admin'}};
    const response=res(); await updateUserAccess(req,response);
    expect(response.status).toHaveBeenCalledWith(400);
  });
});
