export const load = ({ params }: { params: { code: string } }) => {
	return { code: params.code.toUpperCase() };
};
